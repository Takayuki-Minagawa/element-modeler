import { FINGERPRINT_VERSION, modelFingerprint } from './fingerprint.js';

const validVector = (v, n) => Array.isArray(v) && v.length === n && v.every(Number.isFinite);
function unique(rows, name) {
  if (!Array.isArray(rows)) throw new Error(`${name}: expected array`);
  const out = new Map();
  for (const row of rows) {
    if (!Number.isSafeInteger(row.id) || row.id < 1 || out.has(row.id)) throw new Error(`${name}: duplicate/invalid ID`);
    out.set(row.id, row);
  }
  return out;
}

/** Reject stale, partial, failed or malformed results before any overlay is displayed. */
export async function validateAnalysisResult(model, result) {
  if (result?.format !== 'element-modeler-analysis-result' || result.version !== 1 || result.status !== 'success' ||
      result.fingerprintVersion !== FINGERPRINT_VERSION) throw new Error('Unsupported or unsuccessful analysis result');
  if (result.modelFingerprint !== await modelFingerprint(model)) throw new Error('Stale result: model fingerprint differs');
  if (result.units?.translation !== 'mm' || result.units?.rotation !== 'rad' || result.units?.force !== 'N' ||
      result.units?.moment !== 'N*mm' || result.coordinates?.verticalAxis !== 'z' || result.coordinates?.handedness !== 'right') {
    throw new Error('Unsupported result units or coordinates');
  }
  if (!model.loadCases.includes(result.loadCase)) throw new Error('Result references unknown load case');
  const equilibrium = result.equilibrium;
  if (!equilibrium?.passed || !['applied', 'reactions', 'residual', 'tolerance'].every(k => validVector(equilibrium[k], 6)) ||
      equilibrium.residual.some((v, i) => equilibrium.tolerance[i] < 0 || Math.abs(v) > equilibrium.tolerance[i] ||
        Math.abs(equilibrium.applied[i] + equilibrium.reactions[i] - v) > equilibrium.tolerance[i])) {
    throw new Error('Result equilibrium check is missing or failed');
  }
  const nodes = unique(result.nodes, 'result nodes'), elements = unique(result.elements, 'result elements');
  if (nodes.size !== model.nodes.length || elements.size !== model.elements.length) throw new Error('Incomplete result topology');
  for (const node of model.nodes) {
    const row = nodes.get(node.id);
    if (!row || !validVector(row.position, 3) || !validVector(row.displacement, 6) || !validVector(row.reaction, 6) ||
        row.position.some((v, i) => v !== [node.x, node.y, node.z][i])) throw new Error(`Invalid result node ${node.id}`);
  }
  for (const element of model.elements) {
    const row = elements.get(element.id);
    if (!row || ['sourceId', 'sourceBranch', 'nodeI', 'nodeJ'].some(k => row[k] !== element[k]) ||
        !validVector(row.localEndForces, 12)) throw new Error(`Invalid result element ${element.id}`);
  }
  return { nodes, elements };
}

export const FORCE_COMPONENTS = ['N', 'Qy', 'Qz', 'T', 'My', 'Mz'];
const csvCell = value => /[",\r\n]/.test(String(value)) ? `"${String(value).replaceAll('"', '""')}"` : String(value);

/** Section forces at both member ends from the local end forces applied by the nodes to the element.
 * Nodal loads only: N, Qy, Qz and T are constant, My and Mz vary linearly along local x.
 * Right-handed local axes; tension positive; moments follow the right-hand rule about the local axis.
 */
export function memberInternalForces(localEndForces, length) {
  if (!validVector(localEndForces, 12) || !Number.isFinite(length) || length <= 0) {
    throw new Error('Expected 12 finite end forces and a positive member length');
  }
  const [Ni, Qyi, Qzi, Ti, Myi, Mzi] = localEndForces;
  const clean = values => values.map(v => (v === 0 ? 0 : v)); // avoid -0 in tables and CSV
  return {
    N: clean([-Ni, -Ni]), Qy: clean([-Qyi, -Qyi]), Qz: clean([-Qzi, -Qzi]), T: clean([-Ti, -Ti]),
    My: clean([-Myi, -Myi - length*Qzi]), Mz: clean([-Mzi, -Mzi + length*Qyi]),
  };
}

/** Member section forces at the I and J ends, one CSV row per element (mm, N, N·mm). */
export function buildMemberForceCSV(view) {
  const header = ['load_case', 'element', 'source_id', 'source_branch', 'node_i', 'node_j', 'length_mm',
    ...['i', 'j'].flatMap(end => FORCE_COMPONENTS.map(c => `${c}_${end}_${c.startsWith('Q') || c === 'N' ? 'N' : 'Nmm'}`))];
  const rows = view.members.map(m => [view.loadCase, m.id, m.sourceId, m.sourceBranch, m.nodeI, m.nodeJ, m.axes.length,
    ...[0, 1].flatMap(end => FORCE_COMPONENTS.map(c => Number(m.forces[c][end].toPrecision(10))))]);
  return `${[header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

export function memberAxes(start, end) {
  const delta = end.map((v, i) => v - start[i]);
  const length = Math.hypot(...delta);
  if (!length) throw new Error('Zero-length member');
  const x = delta.map(v => v/length);
  const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const rawY = cross(Math.abs(x[2]) < 0.999 ? [0, 0, 1] : [0, 1, 0], x);
  const y = rawY.map(v => v/Math.hypot(...rawY));
  return { x, y, z: cross(x, y), length };
}

/** Cubic Euler-Bernoulli interpolation, Z-up mm; includes end rotations. */
export async function buildResultView(model, result, { scale = 1, segments = 24 } = {}) {
  if (!Number.isFinite(scale) || scale < 0 || !Number.isInteger(segments) || segments < 1 || segments > 1000) {
    throw new Error('Expected nonnegative deformation scale and segments in 1..1000');
  }
  const { nodes, elements } = await validateAnalysisResult(model, result);
  const extremes = Object.fromEntries(FORCE_COMPONENTS.map(c => [c, 0]));
  const dot = (a, b) => a.reduce((out, v, i) => out + v*b[i], 0);
  const members = model.elements.map(e => {
    const ni = nodes.get(e.nodeI), nj = nodes.get(e.nodeJ);
    const axes = memberAxes(ni.position, nj.position);
    const basis = [axes.x, axes.y, axes.z];
    const local = n => [...basis.map(a => dot(n.displacement.slice(0, 3), a)),
      ...basis.map(a => dot(n.displacement.slice(3), a))];
    const di = local(ni), dj = local(nj), L = axes.length;
    const points = Array.from({ length: segments+1 }, (_, index) => {
      const t = index/segments, h1 = 1-3*t*t+2*t*t*t, h2 = t-2*t*t+t*t*t,
        h3 = 3*t*t-2*t*t*t, h4 = -t*t+t*t*t;
      const displacement = [(1-t)*di[0]+t*dj[0], h1*di[1]+L*h2*di[5]+h3*dj[1]+L*h4*dj[5],
        h1*di[2]-L*h2*di[4]+h3*dj[2]-L*h4*dj[4]];
      return ni.position.map((v, k) => v + t*(nj.position[k]-v) + scale*basis.reduce((s, a, j) => s+a[k]*displacement[j], 0));
    });
    const endForces = elements.get(e.id).localEndForces.slice();
    const forces = memberInternalForces(endForces, L);
    for (const c of FORCE_COMPONENTS) extremes[c] = Math.max(extremes[c], ...forces[c].map(Math.abs));
    return { id: e.id, sourceId: e.sourceId, sourceBranch: e.sourceBranch, nodeI: e.nodeI, nodeJ: e.nodeJ,
      axes, endForces, forces, original: [ni.position, nj.position], deformed: points };
  });
  return { scale, loadCase: result.loadCase, members, nodes: result.nodes, extremes,
    reactions: result.nodes.filter(n => n.reaction.some(v => v !== 0)), warnings: result.warnings || [] };
}
