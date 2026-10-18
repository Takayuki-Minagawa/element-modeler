// Lossless storage boundary for solver input. This checks explicit references,
// not element formulations, stability, units compatibility or solver readiness.
export const EXCHANGE_FORMAT = 'element-modeler-analysis-exchange';
export const EXCHANGE_VERSION = 1;
export const CAD_FINGERPRINT_VERSION = 'cad-structural-json-v1';

function object(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
}

function jsonValue(value, path = 'model', ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} must contain finite numbers`);
    return;
  }
  if (typeof value !== 'object' || ancestors.has(value)) throw new Error(`${path} must be JSON data`);
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${path} must be JSON data`);
  }
  if (Object.getOwnPropertySymbols(value).length) throw new Error(`${path} must be JSON data`);
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) jsonValue(value[i], `${path}[${i}]`, ancestors);
  } else {
    for (const [key, item] of Object.entries(value)) jsonValue(item, `${path}.${key}`, ancestors);
  }
  ancestors.delete(value);
}

function string(value, path) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${path} must be a non-empty string`);
}

function finite(value, path) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${path} must be a finite number`);
}

function integer(value, path, minimum = -Number.MAX_SAFE_INTEGER, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${path} must be a safe integer in [${minimum}, ${maximum}]`);
  }
}

function list(value, path, optional = false) {
  if (optional && value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value;
}

function records(value, path, optional = false) {
  const rows = list(value, path, optional);
  rows.forEach((row, index) => object(row, `${path}[${index}]`));
  return rows;
}

function unique(values, path, check = integer) {
  const ids = new Set();
  values.forEach(value => {
    check(value, path);
    if (ids.has(value)) throw new Error(`Duplicate ${path}: ${value}`);
    ids.add(value);
  });
  return ids;
}

function ref(value, ids, path) {
  if (!ids.has(value)) throw new Error(`Unknown ${path}: ${value}`);
}

function namedRecords(value, path, optional = false) {
  const rows = records(value, path, optional);
  return [rows, unique(rows.map(row => row.name), `${path}.name`, string)];
}

function combinations(rows, cases, path) {
  unique(rows.map(row => row.name), `${path}.name`, string);
  rows.forEach(row => {
    object(row.factors, `${path}.factors`);
    for (const [name, factor] of Object.entries(row.factors)) {
      ref(name, cases, `${path}.factors load case`);
      finite(factor, `${path}.factors.${name}`);
    }
  });
}

function units(value) {
  object(value, 'units');
  string(value.length, 'units.length');
  string(value.force, 'units.force');
}

function validateStructPy(bundle) {
  const model = bundle.model;
  object(model, 'model');
  units(bundle.units);
  integer(model.ndm, 'model.ndm', 1, 3);
  integer(model.ndf, 'model.ndf', 1);
  const dof = (value, path) => integer(value, path, 1, model.ndf);
  const nodes = records(model.nodes, 'model.nodes');
  const nodeIds = unique(nodes.map(node => node.tag), 'model.nodes.tag');
  nodes.forEach(node => {
    finite(node.x, 'model.nodes.x'); finite(node.y, 'model.nodes.y');
    if (node.z !== undefined) finite(node.z, 'model.nodes.z');
  });
  if (list(model.thin_walled_members, 'model.thin_walled_members', true).length) {
    throw new Error('Expand generated thin_walled_members with the solver before importing explicit topology');
  }
  const elements = records(model.elements, 'model.elements');
  const elementIds = unique(elements.map(element => element.tag), 'model.elements.tag');
  elements.forEach(element => {
    string(element.type, 'model.elements.type');
    if (element.node_i !== undefined || element.node_j !== undefined) {
      ref(element.node_i, nodeIds, 'model.elements.node_i');
      ref(element.node_j, nodeIds, 'model.elements.node_j');
    }
    if (element.nodes !== undefined) {
      const connected = list(element.nodes, 'model.elements.nodes');
      if (!connected.length) throw new Error('model.elements.nodes requires explicit connectivity');
      connected.forEach(tag => ref(tag, nodeIds, 'model.elements.nodes'));
    } else if (element.node_i === undefined && element.node_j === undefined) {
      throw new Error('model.elements requires explicit node_i/node_j or nodes connectivity');
    }
  });
  const supports = records(model.supports, 'model.supports', true);
  unique(supports.map(support => support.node_tag), 'model.supports.node_tag');
  for (const support of supports) {
    ref(support.node_tag, nodeIds, 'model.supports.node_tag (explicit supports required)');
    const fixity = list(support.fixity, 'model.supports.fixity');
    if (fixity.length !== model.ndf || fixity.some(value => typeof value !== 'boolean')) {
      throw new Error('model.supports.fixity must contain ndf booleans');
    }
  }
  const masses = records(model.nodal_masses, 'model.nodal_masses', true);
  unique(masses.map(mass => mass.node_tag), 'model.nodal_masses.node_tag');
  for (const mass of masses) {
    ref(mass.node_tag, nodeIds, 'model.nodal_masses.node_tag');
    const values = list(mass.mass, 'model.nodal_masses.mass');
    if (values.length !== model.ndf) throw new Error('model.nodal_masses.mass must contain ndf values');
    values.forEach(value => finite(value, 'model.nodal_masses.mass'));
  }
  for (const constraint of records(model.constraints, 'model.constraints', true)) {
    string(constraint.kind, 'model.constraints.kind');
    ref(constraint.slave_node_tag, nodeIds, 'model.constraints.slave_node_tag');
    dof(constraint.slave_dof, 'model.constraints.slave_dof');
    for (const term of records(constraint.terms, 'model.constraints.terms')) {
      ref(term.node_tag, nodeIds, 'model.constraints.terms.node_tag');
      dof(term.dof, 'model.constraints.terms.dof');
      finite(term.coefficient, 'model.constraints.terms.coefficient');
    }
  }
  if (model.groups !== undefined) {
    object(model.groups, 'model.groups');
    for (const [name, group] of Object.entries(model.groups)) {
      object(group, `model.groups.${name}`);
      list(group.nodes, `model.groups.${name}.nodes`, true).forEach(tag => ref(tag, nodeIds, 'model.groups.nodes'));
      list(group.elements, `model.groups.${name}.elements`, true).forEach(tag => ref(tag, elementIds, 'model.groups.elements'));
    }
  }
  list(model.inactive_elements, 'model.inactive_elements', true)
    .forEach(tag => ref(tag, elementIds, 'model.inactive_elements'));
  const [cases, caseNames] = namedRecords(bundle.load_cases, 'load_cases', true);
  cases.forEach(loadCase => {
    for (const kind of ['nodal_loads', 'nodal_displacements']) {
      records(loadCase[kind], `load_cases.${kind}`, true)
        .forEach(load => {
          ref(load.node_tag, nodeIds, `load_cases.${kind}.node_tag (explicit loads required)`);
          const components = kind === 'nodal_loads' ? ['fx', 'fy', 'fz', 'mx', 'my', 'mz'] : ['ux', 'uy', 'uz', 'rx', 'ry', 'rz'];
          for (const key of components) {
            if (load[key] !== undefined) finite(load[key], `load_cases.${kind}.${key}`);
          }
        });
    }
    records(loadCase.element_loads, 'load_cases.element_loads', true).forEach(load => {
      ref(load.element_tag, elementIds, 'load_cases.element_loads.element_tag (explicit loads required)');
      string(load.type, 'load_cases.element_loads.type');
      if (load.type === 'beamUniform') {
        for (const key of ['wx', 'wy', 'wz']) {
          if (load[key] !== undefined) finite(load[key], `load_cases.element_loads.${key}`);
        }
      }
    });
  });
  combinations(records(bundle.load_combinations, 'load_combinations', true), caseNames, 'load_combinations');
}

function validateAnalysisV2(model) {
  units(model.units);
  const nodes = records(model.nodes, 'nodes');
  const positiveId = (value, path) => integer(value, path, 1);
  const nodeIds = unique(nodes.map(node => node.id), 'nodes.id', positiveId);
  nodes.forEach(node => ['x', 'y', 'z'].forEach(key => finite(node[key], `nodes.${key}`)));
  const sections = records(model.sections, 'sections');
  const sectionIds = unique(sections.map(row => row.id), 'sections.id', positiveId);
  const [, materialNames] = namedRecords(model.materials, 'materials');
  const springs = records(model.springs, 'springs');
  const springSymbols = unique(springs.map(row => row.symbol), 'springs.symbol', string);
  const elements = records(model.elements, 'elements');
  const elementIds = unique(elements.map(element => element.id), 'elements.id', positiveId);
  const springRef = (symbol, path) => { if (symbol !== null && symbol !== undefined) ref(symbol, springSymbols, path); };
  elements.forEach(element => {
    ref(element.nodeI, nodeIds, 'elements.nodeI'); ref(element.nodeJ, nodeIds, 'elements.nodeJ');
    if (element.sectionId !== null && element.sectionId !== undefined) ref(element.sectionId, sectionIds, 'elements.sectionId');
    if (element.material !== null && element.material !== undefined) ref(element.material, materialNames, 'elements.material');
    for (const end of ['endI', 'endJ']) {
      if (element[end] !== undefined && element[end] !== null) {
        object(element[end], `elements.${end}`);
        springRef(element[end].springSymbol, `elements.${end}.springSymbol`);
      }
    }
  });
  for (const section of sections) {
    if (section.material !== null && section.material !== undefined) ref(section.material, materialNames, 'sections.material');
  }
  for (const section of records(model.surfaceSections, 'surfaceSections', true)) {
    if (section.material !== null && section.material !== undefined) ref(section.material, materialNames, 'surfaceSections.material');
    springRef(section.endRotationalSpring, 'surfaceSections.endRotationalSpring');
    if (section.edgeSprings !== undefined) {
      object(section.edgeSprings, 'surfaceSections.edgeSprings');
      Object.values(section.edgeSprings).forEach(symbol => springRef(symbol, 'surfaceSections.edgeSprings'));
    }
  }
  const supports = records(model.supports, 'supports');
  unique(supports.map(support => support.id), 'supports.id', positiveId);
  supports.forEach(support => {
    ref(support.nodeId, nodeIds, 'supports.nodeId');
    for (const key of ['dx', 'dy', 'dz', 'rx', 'ry', 'rz']) {
      if (typeof support[key] !== 'boolean') throw new Error(`supports.${key} must be a boolean`);
    }
  });
  const cases = unique(list(model.loadCases, 'loadCases'), 'loadCases', string);
  const loads = records(model.loads, 'loads');
  unique(loads.map(load => load.id), 'loads.id', positiveId);
  loads.forEach(load => {
    ref(load.loadCase, cases, 'loads.loadCase');
    if (load.nodeId !== undefined && load.nodeId !== null) ref(load.nodeId, nodeIds, 'loads.nodeId');
    if (load.elementId !== undefined && load.elementId !== null) ref(load.elementId, elementIds, 'loads.elementId');
  });
  const combos = records(model.loadCombinations, 'loadCombinations');
  unique(combos.map(row => row.id), 'loadCombinations.id', (value, path) => {
    if (typeof value === 'number') integer(value, path);
    else string(value, path);
  });
  combinations(combos, cases, 'loadCombinations');
  if (model.massSources !== undefined) {
    object(model.massSources, 'massSources');
    for (const [name, factor] of Object.entries(model.massSources)) {
      ref(name, cases, 'massSources load case');
      if (factor !== null) finite(factor, `massSources.${name}`);
    }
  }
}

function modelFormat(model) {
  object(model, 'model');
  if (model.format === 'element-modeler-analysis' && model.version === 2) {
    validateAnalysisV2(model);
    return 'element-modeler-analysis-v2';
  }
  if (model.schema_version === '1' && model.format === undefined) {
    validateStructPy(model);
    return 'fem-struct-pygo-v1';
  }
  throw new Error('Unsupported analysis model format/version');
}

function fingerprint(value) {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    throw new Error('sourceCad.fingerprint must be a SHA-256 fingerprint');
  }
}

export function createExchange(model, sourceFingerprint) {
  jsonValue(model);
  fingerprint(sourceFingerprint);
  return {
    format: EXCHANGE_FORMAT, version: EXCHANGE_VERSION,
    sourceCad: { fingerprintVersion: CAD_FINGERPRINT_VERSION, fingerprint: sourceFingerprint },
    modelFormat: modelFormat(model), model: structuredClone(model),
  };
}

export function validateExchange(value) {
  jsonValue(value, 'analysisExchange');
  object(value, 'analysisExchange');
  if (value.format !== EXCHANGE_FORMAT || value.version !== EXCHANGE_VERSION) {
    throw new Error('Unsupported analysis exchange format/version');
  }
  object(value.sourceCad, 'sourceCad');
  if (value.sourceCad.fingerprintVersion !== CAD_FINGERPRINT_VERSION) {
    throw new Error('Unsupported sourceCad.fingerprintVersion');
  }
  fingerprint(value.sourceCad.fingerprint);
  if (value.modelFormat !== modelFormat(value.model)) throw new Error('analysisExchange.modelFormat does not match model');
  return structuredClone(value);
}

export function summarizeExchange(exchange) {
  const checked = validateExchange(exchange);
  const raw = checked.model;
  const native = checked.modelFormat === 'fem-struct-pygo-v1';
  const model = native ? raw.model : raw;
  return {
    modelFormat: checked.modelFormat, nodes: model.nodes.length, elements: model.elements.length,
    springs: native ? model.elements.filter(element => /spring|zeroLength/i.test(element.type)).length : model.springs.length,
    constraints: Array.isArray(model.constraints) ? model.constraints.length : 0,
    loadCases: (native ? raw.load_cases || [] : raw.loadCases).length,
    loadCombinations: (native ? raw.load_combinations || [] : raw.loadCombinations).length,
    units: structuredClone(raw.units),
  };
}
