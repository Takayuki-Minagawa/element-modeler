import { diagnosticTargets } from './domain/diagnostics.js';
// analysis-preflight.js - Solver-facing validation performed immediately
// before analysis JSON/CSV export. The checks are intentionally limited to
// conditions that can be established without assembling an element stiffness
// matrix: valid source references/properties and restraint of the six rigid
// body modes in every connected element component.

import { buildAnalysisModel } from './analysis-export.js';

const RIGID_BODY_DOF_COUNT = 6;
const RANK_TOLERANCE = 1e-9;

function matrixRank(rows, columnCount = RIGID_BODY_DOF_COUNT) {
  const matrix = rows.map(row => row.slice(0, columnCount));
  let rank = 0;

  for (let column = 0; column < columnCount && rank < matrix.length; column++) {
    let pivotRow = rank;
    for (let row = rank + 1; row < matrix.length; row++) {
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivotRow][column])) {
        pivotRow = row;
      }
    }
    if (Math.abs(matrix[pivotRow][column]) <= RANK_TOLERANCE) continue;

    [matrix[rank], matrix[pivotRow]] = [matrix[pivotRow], matrix[rank]];
    const pivot = matrix[rank][column];
    for (let c = column; c < columnCount; c++) matrix[rank][c] /= pivot;

    for (let row = 0; row < matrix.length; row++) {
      if (row === rank) continue;
      const factor = matrix[row][column];
      if (Math.abs(factor) <= RANK_TOLERANCE) continue;
      for (let c = column; c < columnCount; c++) {
        matrix[row][c] -= factor * matrix[rank][c];
      }
    }
    rank++;
  }
  return rank;
}

function connectedComponents(model) {
  const adjacency = new Map();
  const elementIdsByNode = new Map();
  const connect = (a, b, elementId) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a).add(b);
    adjacency.get(b).add(a);
    if (!elementIdsByNode.has(a)) elementIdsByNode.set(a, new Set());
    if (!elementIdsByNode.has(b)) elementIdsByNode.set(b, new Set());
    elementIdsByNode.get(a).add(elementId);
    elementIdsByNode.get(b).add(elementId);
  };
  for (const element of model.elements) connect(element.nodeI, element.nodeJ, element.id);

  const visited = new Set();
  const components = [];
  for (const startNodeId of adjacency.keys()) {
    if (visited.has(startNodeId)) continue;
    const nodeIds = [];
    const elementIds = new Set();
    const pending = [startNodeId];
    visited.add(startNodeId);
    while (pending.length) {
      const nodeId = pending.pop();
      nodeIds.push(nodeId);
      for (const elementId of elementIdsByNode.get(nodeId) || []) elementIds.add(elementId);
      for (const adjacentNodeId of adjacency.get(nodeId) || []) {
        if (visited.has(adjacentNodeId)) continue;
        visited.add(adjacentNodeId);
        pending.push(adjacentNodeId);
      }
    }
    components.push({ nodeIds, elementIds: [...elementIds] });
  }
  return components;
}

function restraintRank(component, model, nodeById) {
  const componentNodeIds = new Set(component.nodeIds);
  const componentSupports = model.supports.filter(support => componentNodeIds.has(support.nodeId));
  const points = component.nodeIds.map(id => nodeById.get(id)).filter(Boolean);
  const centroid = points.reduce((sum, point) => ({
    x: sum.x + point.x / points.length,
    y: sum.y + point.y / points.length,
    z: sum.z + point.z / points.length,
  }), { x: 0, y: 0, z: 0 });
  const scale = Math.max(1, ...points.map(point => Math.hypot(
    point.x - centroid.x,
    point.y - centroid.y,
    point.z - centroid.z
  )));
  const rows = [];

  for (const support of componentSupports) {
    const point = nodeById.get(support.nodeId);
    if (!point) continue;
    const x = (point.x - centroid.x) / scale;
    const y = (point.y - centroid.y) / scale;
    const z = (point.z - centroid.z) / scale;
    if (support.dx) rows.push([1, 0, 0, 0, z, -y]);
    if (support.dy) rows.push([0, 1, 0, -z, 0, x]);
    if (support.dz) rows.push([0, 0, 1, y, -x, 0]);
    if (support.rx) rows.push([0, 0, 0, 1, 0, 0]);
    if (support.ry) rows.push([0, 0, 0, 0, 1, 0]);
    if (support.rz) rows.push([0, 0, 0, 0, 0, 1]);
  }

  return {
    rank: matrixRank(rows),
    supportIds: componentSupports.map(support => support.sourceId),
  };
}

function issue(severity, code, messageKey, params = {}, targets = []) {
  const unique = [...new Map(targets.map(ref => [`${ref.elementType}:${ref.elementId}`, ref])).values()];
  return { severity, code, messageKey, params, targets: unique, ...(unique[0] || {}) };
}

export function buildAnalysisPreflight(state, options = {}) {
  const model = options.model || buildAnalysisModel(state, options);
  const issues = [];
  const memberTargets = elements => elements.filter(element => element.sourceId !== null && element.sourceId !== undefined)
    .map(element => ({ elementType: 'member', elementId: element.sourceId }));
  const sourceErrors = state.validateModel().filter(item => item.severity === 'error');
  if (sourceErrors.length) {
    issues.push(issue('error', 'source-model-errors', 'analysisPreflightSourceErrors', {
      count: sourceErrors.length,
    }, sourceErrors.flatMap(diagnosticTargets)));
    issues.push(...sourceErrors);
  }
  if (!model.elements.length) {
    issues.push(issue('error', 'no-elements', 'analysisPreflightNoElements'));
  }

  const warningFields = [
    ['undefinedMaterialProperties', 'undefinedMaterialNames', 'undefined-materials', 'analysisPreflightUndefinedMaterials'],
    ['undefinedSpringStiffness', 'undefinedSpringSymbols', 'undefined-springs', 'analysisPreflightUndefinedSprings'],
    ['undefinedMassSources', 'undefinedMassSourceCases', 'undefined-mass-sources', 'analysisPreflightUndefinedMassSources'],
  ];
  for (const [flag, values, code, messageKey] of warningFields) {
    if (!model.meta.warnings[flag]) continue;
    const surfaceTargets = (model.surfaces || []).filter(surface => {
      const section = (model.surfaceSections || []).find(item => item.type === surface.type && item.name === surface.sectionName);
      if (!section) return false;
      if (code === 'undefined-materials') return model.meta.warnings[values].includes(section.material);
      if (code === 'undefined-springs') return [section.endRotationalSpring, ...Object.values(section.edgeSprings)]
        .some(symbol => symbol && model.meta.warnings[values].includes(symbol));
      return false;
    }).map(surface => ({ elementType: 'surface', elementId: surface.sourceId }));
    issues.push(issue('error', code, messageKey, {
      values: model.meta.warnings[values].join(', '),
    }, code === 'undefined-mass-sources'
      ? state.loads.filter(load => model.meta.warnings[values].includes(load.loadCase))
        .map(load => ({ elementType: 'load', elementId: load.id }))
      : state.members.filter(member => code === 'undefined-materials'
        ? model.meta.warnings[values].includes(member.material)
        : [member.endI, member.endJ].some(end => end?.condition === 'spring' && model.meta.warnings[values].includes(end.springSymbol)))
        .map(member => ({ elementType: 'member', elementId: member.id })).concat(surfaceTargets)));
  }

  const undefinedSections = model.elements.filter(element => element.sectionId === null);
  if (undefinedSections.length) {
    issues.push(issue('error', 'undefined-sections', 'analysisPreflightUndefinedSections', {
      count: undefinedSections.length,
    }, memberTargets(undefinedSections)));
  }

  const components = connectedComponents(model);
  const nodeById = new Map(model.nodes.map(node => [node.id, node]));
  components.forEach((component, index) => {
    const restraint = restraintRank(component, model, nodeById);
    if (restraint.rank >= RIGID_BODY_DOF_COUNT) return;
    issues.push(issue('error', 'rigid-body-modes', 'analysisPreflightRigidBodyModes', {
      component: index + 1,
      elements: component.elementIds.length,
      modes: RIGID_BODY_DOF_COUNT - restraint.rank,
    }, memberTargets(model.elements.filter(element => component.elementIds.includes(element.id)))));
  });

  if (components.length > 1) {
    issues.push(issue('warning', 'multiple-components', 'analysisPreflightMultipleComponents', {
      count: components.length,
    }, memberTargets(model.elements)));
  }
  const elementNodeIds = new Set(components.flatMap(component => component.nodeIds));
  const orphanSupports = model.supports.filter(support => !elementNodeIds.has(support.nodeId));
  if (orphanSupports.length) {
    issues.push(issue('warning', 'orphan-supports', 'analysisPreflightOrphanSupports', {
      count: orphanSupports.length,
    }, orphanSupports.map(support => ({ elementType: 'support', elementId: support.sourceId }))));
  }

  return {
    canExport: !issues.some(item => item.severity === 'error'),
    model,
    issues,
    summary: {
      nodes: model.nodes.length,
      elements: model.elements.length,
      supports: model.supports.length,
      components: components.length,
      errors: issues.filter(item => item.severity === 'error').length,
      warnings: issues.filter(item => item.severity === 'warning').length,
    },
  };
}
