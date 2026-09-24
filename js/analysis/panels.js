// Standalone DOM modules. Parent owns file picking, state revisions and mounting.
import { FORCE_COMPONENTS, buildMemberForceCSV, buildResultView } from './results.js';
import { previewToPointLoads } from './load-distribution.js';

const NS = 'http://www.w3.org/2000/svg';
const messages = {
  en: {
    results: 'Linear static results', preview: 'Load assignment', select: 'Select', node: 'Node', member: 'Member / branch',
    position: 'Position [mm]', original: 'Original force [N]', moment: 'Moment at origin [N·mm]', residual: 'Conservation residual',
    tributary: 'Tributary width per support', export: 'Export nodal assignments',
    view: 'grey original / blue deformed. Z-up, mm. Forces N, moments N·mm.', scale: 'Deformation',
    accept: 'I accept endpoint lumping; distributed-load beam bending is omitted.',
    required: 'Accept the lumping limitation before exporting.',
    exported: 'Nodal assignments exported. Replace the original load to avoid double counting.',
    stale: 'Model changed. Reload results for the current model.',
    line: 'Endpoint lumping conserves force and moment, but omits distributed-load member bending/fixed-end forces.',
    slab: 'Uniform one-way tributary distribution only; no slab stiffness/two-way action. Nodal export uses static lumping.',
    gravity: 'Density self-weight explicitly omitted; this is a load-only analysis.',
    component: 'Force diagram', forces: 'Section forces (I end → J end)', exportForces: 'Export member forces CSV',
    forcesExported: 'Member forces CSV exported.',
    convention: 'Section forces are derived from the end forces the nodes apply to each element. Tension positive; moments follow the right-hand rule about the local axis. Positive ordinates are drawn toward local +y (Qy), local -y (Mz) or local +z (N, Qz, T, My), so My and Mz appear on the tension side; components normal to the projection plane collapse onto the member line.',
    diagram: 'Diagram', maxAbs: 'max |value|', negligible: 'Values are numerical noise; no diagram is drawn.',
  },
  ja: {
    results: '線形静的解析結果', preview: '荷重配分プレビュー', select: '選択', node: '節点', member: '部材 / 枝番',
    position: '位置 [mm]', original: '元荷重の合力 [N]', moment: '原点まわりのモーメント [N·mm]', residual: '配分前後の残差',
    tributary: '支持部材ごとの支配幅', export: '配分後の節点荷重を出力',
    view: '灰色：元形状 / 青色：変形後。Z上向き、mm。力 N、モーメント N·mm。', scale: '変形倍率',
    accept: '端部節点への集中配分を了承します。分布荷重による部材内の曲げ・固定端力は再現しません。',
    required: '集中配分の制限事項に同意してから出力してください。',
    exported: '節点荷重を出力しました。二重計上を避けるため元荷重を置き換えてください。',
    stale: 'モデルが変更されました。現在のモデルに対応する解析結果を読み直してください。',
    line: '端部節点への集中配分は合力とモーメントを保存しますが、分布荷重による部材内の曲げ・固定端力は再現しません。',
    slab: '等分布荷重を受ける矩形床の一方向配分のみ。床剛性・二方向作用は対象外。節点荷重出力は端部への集中配分です。',
    gravity: '密度からの自重を明示的に省略しています。指定した節点荷重のみの解析です。',
    component: '応力図', forces: '断面力（I端 → J端）', exportForces: '材端力CSVを出力',
    forcesExported: '材端力CSVを出力しました。',
    convention: '断面力は節点が要素へ与える材端力から算出します。引張正、モーメントは局所軸まわりの右手則。図の正側は局所+y（Qy）、局所−y（Mz）、局所+z（N, Qz, T, My）で、My・Mz は引張側に描きます。表示面に直交する成分は部材線上に重なります。',
    diagram: '応力図', maxAbs: '最大絶対値', negligible: '数値誤差程度の大きさのため図は描きません。',
  },
};
function element(doc, tag, text) {
  const node = doc.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}
function table(doc, headers, rows) {
  const out = element(doc, 'table');
  const header = element(doc, 'tr');
  headers.forEach(text => header.append(element(doc, 'th', text)));
  out.append(header);
  for (const cells of rows) {
    const row = element(doc, 'tr');
    cells.forEach(text => row.append(element(doc, 'td', text)));
    out.append(row);
  }
  return out;
}
const values = row => row.map(v => Number(v).toPrecision(6)).join(', ');
function drawing(doc, paths, plane, shapes = []) {
  const indices = plane === 'yz' ? [1, 2] : plane === 'xy' ? [0, 1] : [0, 2];
  const ranges = [[Infinity, -Infinity], [Infinity, -Infinity]];
  for (const path of [...paths, ...shapes]) for (const point of path.points) {
    indices.forEach((axis, i) => {
      ranges[i][0] = Math.min(ranges[i][0], point[axis]);
      ranges[i][1] = Math.max(ranges[i][1], point[axis]);
    });
  }
  const factor = Math.min(540/Math.max(1, ranges[0][1]-ranges[0][0]), 280/Math.max(1, ranges[1][1]-ranges[1][0]));
  const project = p => [(p[indices[0]]-ranges[0][0])*factor+30, 330-(p[indices[1]]-ranges[1][0])*factor];
  const svg = doc.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 600 360');
  svg.style.width = '100%'; svg.style.maxHeight = '420px';
  svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `Structural preview ${plane.toUpperCase()}`);
  for (const shape of shapes) {
    const polygon = doc.createElementNS(NS, 'polygon');
    polygon.setAttribute('points', shape.points.map(p => project(p).join(',')).join(' '));
    polygon.setAttribute('fill', shape.color); polygon.setAttribute('fill-opacity', '0.35');
    polygon.setAttribute('stroke', shape.color); polygon.setAttribute('stroke-width', '1');
    polygon.setAttribute('class', 'force-diagram');
    const title = doc.createElementNS(NS, 'title'); title.textContent = shape.label; polygon.append(title);
    svg.append(polygon);
  }
  for (const path of paths) {
    const line = doc.createElementNS(NS, 'polyline');
    line.setAttribute('points', path.points.map(p => project(p).join(',')).join(' '));
    line.setAttribute('fill', 'none'); line.setAttribute('stroke', path.color);
    line.setAttribute('stroke-width', '2');
    const title = doc.createElementNS(NS, 'title'); title.textContent = path.label; line.append(title);
    svg.append(line);
  }
  return svg;
}

const FORCE_UNIT_GROUPS = [['N', 'Qy', 'Qz'], ['T', 'My', 'Mz']];
const NOISE_FLOOR = { N: 1e-6, Qy: 1e-6, Qz: 1e-6, T: 1e-3, My: 1e-3, Mz: 1e-3 };
/** Solver round-off (e.g. out-of-plane torsion in a planar frame) must not be drawn at full size. */
export function isSignificantComponent(extremes, component) {
  const extreme = extremes[component];
  if (!(extreme > NOISE_FLOOR[component])) return false;
  const peers = FORCE_UNIT_GROUPS.find(group => group.includes(component));
  const largest = Math.max(...peers.map(c => extremes[c]));
  return extreme > 1e-6 * largest;
}

/** One quadrilateral per member: the member line plus ordinates along local +y (Qy, Mz) or +z (others),
 * scaled so the largest ordinate spans a fixed fraction of the model extent. */
export function forceDiagramShapes(view, component, { fraction = 0.15 } = {}) {
  if (!isSignificantComponent(view.extremes, component)) return [];
  const extreme = view.extremes[component];
  const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
  let extent = 0;
  for (const m of view.members) {
    extent = Math.max(extent, m.axes.length);
    for (const p of m.original) for (let axis = 0; axis < 3; axis++) {
      low[axis] = Math.min(low[axis], p[axis]); high[axis] = Math.max(high[axis], p[axis]);
    }
  }
  for (let axis = 0; axis < 3; axis++) extent = Math.max(extent, high[axis] - low[axis]);
  const factor = fraction * extent / extreme;
  const color = { N: '#d9534f', Qy: '#5cb85c', Qz: '#5cb85c', T: '#8e44ad', My: '#f0ad4e', Mz: '#f0ad4e' }[component];
  return view.members.map(m => {
    // Moments are drawn on the tension side: +My (right-hand rule) puts tension
    // at local +z, +Mz puts tension at local -y.
    const direction = component === 'Qy' ? m.axes.y : component === 'Mz' ? m.axes.y.map(v => -v) : m.axes.z;
    const [vi, vj] = m.forces[component];
    const offset = (point, value) => point.map((coordinate, k) => coordinate + direction[k]*value*factor);
    return { points: [m.original[0], offset(m.original[0], vi), offset(m.original[1], vj), m.original[1]], color,
      label: `${m.sourceId}/${m.sourceBranch} ${component}: ${Number(vi.toPrecision(6))} → ${Number(vj.toPrecision(6))}` };
  });
}

/** Returns {dispose, invalidate}; call invalidate immediately on model edits.
 * Selection callback: ({elementId, sourceId, sourceBranch}). No state mutation.
 */
export async function mountResultsPanel(container, model, result, { scale = 1, plane = 'xz', component = 'none', language = 'en', onSelect = () => {}, onExportForces = null } = {}) {
  const t = messages[language] || messages.en;
  if (component !== 'none' && !FORCE_COMPONENTS.includes(component)) throw new Error('Unknown force component');
  const view = await buildResultView(model, result, { scale });
  const doc = container.ownerDocument;
  const root = element(doc, 'section'); root.setAttribute('aria-label', t.results);
  root.append(element(doc, 'h3', `${t.results} — ${view.loadCase}`));
  root.append(element(doc, 'p', `${t.scale} ×${scale}; ${t.view}`));
  view.warnings.forEach(warning => root.append(element(doc, 'p', warning === messages.en.gravity ? t.gravity : warning)));
  const shapes = component === 'none' ? [] : forceDiagramShapes(view, component);
  const plot = drawing(doc, view.members.flatMap(m => [
    { points: m.original, color: '#888', label: `${m.sourceId}/${m.sourceBranch} original` },
    { points: m.deformed, color: '#168ce0', label: `${m.sourceId}/${m.sourceBranch} deformed` },
  ]), plane, shapes);
  root.append(plot);
  if (component !== 'none') {
    const unit = component === 'N' || component.startsWith('Q') ? 'N' : 'N·mm';
    const note = shapes.length ? '' : ` ${t.negligible}`;
    root.append(element(doc, 'p', `${t.diagram}: ${component} [${unit}]; ${t.maxAbs} ${Number(view.extremes[component].toPrecision(6))}.${note} ${t.convention}`));
  }
  root.append(table(doc, [t.node, 'ux, uy, uz [mm]; rx, ry, rz [rad]', 'Fx, Fy, Fz [N]; Mx, My, Mz [N·mm]'],
    view.nodes.map(n => [n.id, values(n.displacement), values(n.reaction)])));
  root.append(element(doc, 'h4', t.forces));
  root.append(table(doc, [t.member, 'N, Qy, Qz [N]; T, My, Mz [N·mm] @ I', 'N, Qy, Qz [N]; T, My, Mz [N·mm] @ J'],
    view.members.map(m => [`${m.sourceId}/${m.sourceBranch} (${m.id})`,
      values(FORCE_COMPONENTS.map(c => m.forces[c][0])), values(FORCE_COMPONENTS.map(c => m.forces[c][1]))])));
  const handlers = [];
  const bind = (button, handler) => { button.type = 'button'; button.addEventListener('click', handler); handlers.push([button, handler]); root.append(button); };
  if (onExportForces) {
    const status = element(doc, 'p'); status.setAttribute('role', 'status');
    bind(element(doc, 'button', t.exportForces), () => { onExportForces(buildMemberForceCSV(view), view.loadCase); status.textContent = t.forcesExported; });
    root.append(status);
  }
  for (const member of view.members) {
    bind(element(doc, 'button', `${t.select} ${member.sourceId}/${member.sourceBranch}`),
      () => onSelect({ elementId: member.id, sourceId: member.sourceId, sourceBranch: member.sourceBranch }));
  }
  container.append(root);
  const cleanup = () => handlers.forEach(([button, handler]) => button.removeEventListener('click', handler));
  return {
    dispose() { cleanup(); root.remove(); },
    invalidate() { cleanup(); root.replaceChildren(element(doc, 'p', t.stale)); },
  };
}

/** onExport receives explicit nodal loads after the user accepts static lumping. */
export function mountLoadPreview(container, preview, { onSelect = () => {}, onExport = () => {}, firstId = 1, plane = 'xy', language = 'en' } = {}) {
  const t = messages[language] || messages.en;
  if (!preview.conservation?.passed) throw new Error('Conserved preview required');
  const doc = container.ownerDocument, root = element(doc, 'section');
  root.setAttribute('aria-label', t.preview);
  root.append(element(doc, 'h3', `${t.preview} — ${preview.sourceId ?? preview.kind}`));
  root.append(element(doc, 'p', preview.kind === 'line' ? t.line : t.slab));
  if (preview.tributaryWidth !== undefined) root.append(element(doc, 'p', `${t.tributary}: ${preview.tributaryWidth} mm`));
  const lines = preview.lines || [preview];
  root.append(drawing(doc, lines.map(line => ({ points: [line.start, line.end], color: '#168ce0', label: `Member ${line.elementId}` })), plane));
  root.append(table(doc, [t.member, t.node, 'Fx, Fy, Fz [N]', t.position], preview.targets.map(row =>
    [`${row.sourceId}/${row.sourceBranch}`, row.nodeId, values(row.force), values(row.position)])));
  root.append(element(doc, 'p', `${t.original}: ${values(preview.conservation.original.force)}; ${t.moment}: ${values(preview.conservation.original.moment)}`));
  root.append(element(doc, 'p', `${t.residual}: F ${values(preview.conservation.forceResidual)}; M ${values(preview.conservation.momentResidual)}`));
  const handlers = [];
  const bind = (button, handler) => { button.type = 'button'; button.addEventListener('click', handler); handlers.push([button, handler]); root.append(button); };
  for (const line of lines) {
    const row = line.targets[0];
    bind(element(doc, 'button', `${t.select} ${row.sourceId}/${row.sourceBranch}`),
      () => onSelect({ elementId: row.elementId, sourceId: row.sourceId, sourceBranch: row.sourceBranch }));
  }
  const label = element(doc, 'label');
  const accept = element(doc, 'input'); accept.type = 'checkbox';
  label.append(accept, doc.createTextNode(` ${t.accept}`));
  root.append(label);
  const output = element(doc, 'p'); output.setAttribute('role', 'status');
  bind(element(doc, 'button', t.export), () => {
    if (!accept.checked) { output.textContent = t.required; return; }
    onExport(previewToPointLoads(preview, { firstId, acknowledgeLumping: true }));
    output.textContent = t.exported;
  });
  root.append(output); container.append(root);
  return { dispose() { handlers.forEach(([button, handler]) => button.removeEventListener('click', handler)); root.remove(); } };
}
