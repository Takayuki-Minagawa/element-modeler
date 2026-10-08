// analysis-export.js - Builds a solver-neutral analysis model from the CAD
// state: shared 3D nodes, element connectivity, sections, member end
// conditions, supports, loads (grouped by load case) and load combinations.
// Everything is exported in a consistent mm-N base system: length mm,
// force N, line load N/mm, area load N/mm2, moment N*mm. UI-entered load
// values (N/m, N/m², N·m) are converted here.

import { normalizeAnalysisSettings } from './analysis-settings.js';
import { resolveMemberEndZ } from './quantities.js';
import { APP_VERSION, LOAD_CASES } from './constants.js';
import {
  normalizeSectionShape,
  normalizeSectionType,
  normalizeSpringStiffness,
  optionalRatio,
  sectionProperties,
} from './section-catalog.js';
import { normalizeLoadCase } from './state.js';

export const ANALYSIS_FORMAT = 'element-modeler-analysis';
export const ANALYSIS_FORMAT_VERSION = 2;

// Endpoints closer than this merge into one analysis node. CAD input is
// mm-scale, so anything closer is the same physical point.
export const NODE_MERGE_TOLERANCE = 0.1;

// Node pool that merges points by real Euclidean distance. A spatial hash
// with cell size = tolerance keeps lookups O(1). Rounded cell indices can put
// points within tolerance up to two cells apart in an axis, so the lookup
// scans the full 5x5x5 neighborhood.
function createNodePool(tolerance) {
  const nodes = [];
  const cells = new Map();
  const cellIndex = v => Math.round(v / tolerance);
  // Distances exactly at the tolerance must merge; floating-point subtraction
  // can overshoot by a few ULP (e.g. 0.4 - 0.3 > 0.1), and at km-scale
  // coordinates the ULP itself approaches 1e-10 mm. An epsilon of 1e-6 x
  // tolerance absorbs both while staying far below any real gap.
  const mergeDistance = tolerance * (1 + 1e-6);
  // Rounded cell indices of two points one tolerance apart can differ by 2
  // (e.g. 0.15 -> cell 1 but 0.25 -> cell 3), so the neighborhood scan must
  // cover +-2 cells per axis, not just the adjacent ones.
  const CELL_RANGE = 2;

  return {
    nodes,
    idFor(x, y, z) {
      const cx = cellIndex(x);
      const cy = cellIndex(y);
      const cz = cellIndex(z);
      for (let dx = -CELL_RANGE; dx <= CELL_RANGE; dx++) {
        for (let dy = -CELL_RANGE; dy <= CELL_RANGE; dy++) {
          for (let dz = -CELL_RANGE; dz <= CELL_RANGE; dz++) {
            const bucket = cells.get(`${cx + dx}|${cy + dy}|${cz + dz}`);
            if (!bucket) continue;
            for (const node of bucket) {
              if (Math.hypot(node.x - x, node.y - y, node.z - z) <= mergeDistance) {
                return node.id;
              }
            }
          }
        }
      }
      const node = { id: nodes.length + 1, x, y, z };
      nodes.push(node);
      const key = `${cx}|${cy}|${cz}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(node);
      return node.id;
    },
  };
}

const memberEndZ = resolveMemberEndZ;

function cloneEnd(end) {
  return {
    condition: end?.condition || 'pin',
    springSymbol: end?.condition === 'spring' ? (end.springSymbol || null) : null,
  };
}

// Converts one CAD load to the mm-N base system:
// lineLoad N/m -> N/mm, areaLoad N/m² -> N/mm², moments N·m -> N·mm.
function convertLoad(state, load, id) {
  const out = {
    ...load,
    id,
    sourceId: load.id,
    loadCase: normalizeLoadCase(load.loadCase),
    z: state.getLevelZ(load.levelId),
  };
  if (load.type === 'lineLoad') {
    out.value = (Number(load.value) || 0) / 1000;
  } else if (load.type === 'areaLoad') {
    out.value = (Number(load.value) || 0) / 1e6;
  } else if (load.type === 'pointLoad') {
    out.mx = (Number(load.mx) || 0) * 1000;
    out.my = (Number(load.my) || 0) * 1000;
    out.mz = (Number(load.mz) || 0) * 1000;
  }
  return out;
}

export function buildAnalysisModel(state, options = {}) {
  const pool = createNodePool(NODE_MERGE_TOLERANCE);
  const generatedAt = options.generatedAt || new Date().toISOString();
  const appVersion = options.appVersion || APP_VERSION;

  const elements = [];
  const pushElement = (member, nodeI, nodeJ, { swapEnds = false, sourceBranch = 'primary' } = {}) => {
    if (nodeI === nodeJ) return; // zero-length after 3D resolution
    elements.push({
      id: elements.length + 1,
      sourceId: member.id,
      sourceBranch,
      type: member.type,
      nodeI,
      nodeJ,
      sectionName: member.sectionName || null,
      material: member.material || 'steel',
      b: member.section?.b ?? null,
      h: member.section?.h ?? null,
      endI: cloneEnd(swapEnds ? member.endJ : member.endI),
      endJ: cloneEnd(swapEnds ? member.endI : member.endJ),
      levelId: member.levelId,
      roofRole: member.roofRole || null,
      bracePattern: member.type === 'vbrace' ? (member.bracePattern || 'single') : null,
    });
  };

  for (const member of state.members) {
    const n1 = state.getNode(member.startNodeId);
    const n2 = state.getNode(member.endNodeId);
    if (!n1 || !n2) continue;
    const startZ = memberEndZ(state, member, 'start');
    const endZ = memberEndZ(state, member, 'end');
    pushElement(member,
      pool.idFor(n1.x, n1.y, startZ),
      pool.idFor(n2.x, n2.y, endZ));
    // A cross (X) brace is one CAD member but two analysis diagonals: the
    // second one mirrors the plan endpoints between the same two levels, so
    // its end conditions swap with the endpoints (end I sits on plan point 2).
    if (member.type === 'vbrace' && member.bracePattern === 'cross') {
      pushElement(member,
        pool.idFor(n2.x, n2.y, startZ),
        pool.idFor(n1.x, n1.y, endZ),
        { swapEnds: true, sourceBranch: 'cross' });
    }
  }

  const supports = state.supports.map((sup, index) => ({
    id: index + 1,
    sourceId: sup.id,
    nodeId: pool.idFor(sup.x, sup.y, state.getLevelZ(sup.levelId)),
    dx: !!sup.dx,
    dy: !!sup.dy,
    dz: !!sup.dz,
    rx: !!sup.rx,
    ry: !!sup.ry,
    rz: !!sup.rz,
  }));

  const loads = state.loads.map((load, index) => convertLoad(state, load, index + 1));

  const memberSectionKey = (type, name) =>
    JSON.stringify([normalizeSectionType('member', type), name]);
  const usedSectionKeys = new Set(
    elements
      .filter(element => element.sectionName)
      .map(element => memberSectionKey(element.type, element.sectionName))
  );
  const sections = state.sectionCatalog
    .filter(section => section.target === 'member' &&
      usedSectionKeys.has(memberSectionKey(section.type, section.name)))
    .map((section, index) => {
      const properties = sectionProperties(section);
      const shearAreaRatioY = optionalRatio(section.shearAreaRatioY);
      const shearAreaRatioZ = optionalRatio(section.shearAreaRatioZ);
      const Avy = finitePositiveOrNull(section.Avy);
      const Avz = finitePositiveOrNull(section.Avz);
      return {
        id: index + 1,
        name: section.name,
        type: section.type,
        material: section.material || 'steel',
        b: section.b,
        h: section.h,
        shape: normalizeSectionShape(section.shape),
        flangeThickness: section.flangeThickness ?? null,
        webThickness: section.webThickness ?? null,
        boxThickness: section.boxThickness ?? null,
        ...properties,
        designation: section.designation || null,
        // Keep the v2 per-property calculation provenance above. The CAD
        // catalog's declared origin is independent and may be unspecified.
        declaredPropertySource: section.propertySource ?? null,
        Avy,
        Avz,
        shearAreaRatioY,
        shearAreaRatioZ,
        Ay: Avy ?? (shearAreaRatioY === null ? null : properties.A * shearAreaRatioY),
        Az: Avz ?? (shearAreaRatioZ === null ? null : properties.A * shearAreaRatioZ),
        isDefault: !!section.isDefault,
      };
    });
  const sectionIdByKey = new Map(
    sections.map(section => [memberSectionKey(section.type, section.name), section.id])
  );
  for (const element of elements) {
    element.sectionId = element.sectionName
      ? (sectionIdByKey.get(memberSectionKey(element.type, element.sectionName)) ?? null)
      : null;
  }

  const usedMaterialNames = new Set([
    ...elements.map(element => element.material).filter(Boolean),
    ...sections.map(section => section.material).filter(Boolean),
  ]);
  const materialByName = new Map(
    (state.materialCatalog || []).map(material => [material.name, material])
  );
  const materials = [...usedMaterialNames].map(name => {
    const material = materialByName.get(name);
    return {
      name,
      E: finitePositiveOrNull(material?.E),
      G: finitePositiveOrNull(material?.G),
      density: finitePositiveOrNull(material?.density),
      isDefault: !!material?.isDefault,
    };
  });

  const usedSpringSymbols = new Set();
  for (const e of elements) {
    if (e.endI.springSymbol) usedSpringSymbols.add(e.endI.springSymbol);
    if (e.endJ.springSymbol) usedSpringSymbols.add(e.endJ.springSymbol);
  }
  const springs = state.springCatalog
    .filter(s => usedSpringSymbols.has(s.symbol))
    .map(s => ({
      symbol: s.symbol,
      kr: normalizeSpringStiffness(s.kr),
      krY: normalizeSpringStiffness(s.krY),
      krZ: normalizeSpringStiffness(s.krZ),
      kt: normalizeSpringStiffness(s.kt),
      memo: s.memo || '',
      isDefault: !!s.isDefault,
    }));

  const analysisSettings = normalizeAnalysisSettings(state.analysisSettings);
  const undefinedSpringSymbols = springs
    .filter(spring => (spring.krY ?? spring.kr) === null || (spring.krZ ?? spring.kr) === null)
    .map(spring => spring.symbol);
  const undefinedMassSourceCases = LOAD_CASES.filter(
    loadCase => analysisSettings.massSources[loadCase] === null
  );
  const undefinedMaterialNames = materials
    .filter(material => material.E === null || material.G === null || material.density === null)
    .map(material => material.name);

  return {
    format: ANALYSIS_FORMAT,
    version: ANALYSIS_FORMAT_VERSION,
    units: {
      length: 'mm',
      force: 'N',
      lineLoad: 'N/mm',
      areaLoad: 'N/mm2',
      moment: 'N*mm',
      mass: 'kg',
      elasticModulus: 'N/mm2',
      shearModulus: 'N/mm2',
      density: 'kg/m3',
      area: 'mm2',
      shearArea: 'mm2',
      secondMomentOfArea: 'mm4',
      torsionConstant: 'mm4',
      rotationalStiffness: 'N*mm/rad',
      translationalStiffness: 'N/mm',
    },
    meta: {
      name: state.meta?.name || 'untitled',
      generator: {
        name: 'element-modeler',
        formatVersion: ANALYSIS_FORMAT_VERSION,
        appVersion,
      },
      generatedAt,
      coordinates: { verticalAxis: 'z', handedness: 'right' },
      nodeOrder: 'ascending-id',
      warnings: {
        undefinedSpringStiffness: undefinedSpringSymbols.length > 0,
        undefinedSpringSymbols,
        undefinedMassSources: undefinedMassSourceCases.length > 0,
        undefinedMassSourceCases,
        undefinedMaterialProperties: undefinedMaterialNames.length > 0,
        undefinedMaterialNames,
      },
    },
    levels: state.levels.map(l => ({ id: l.id, name: l.name, z: l.z })),
    nodes: pool.nodes,
    elements,
    sections,
    materials,
    springs,
    supports,
    loadCases: LOAD_CASES.slice(),
    loads,
    massSources: { ...analysisSettings.massSources },
    selfWeight: {
      mode: analysisSettings.selfWeightMode,
      isDefault: analysisSettings.selfWeightMode === 'fromDensity',
    },
    loadCombinations: state.loadCombinations.map(c => ({
      id: c.id,
      name: c.name,
      factors: { ...c.factors },
    })),
  };
}

function finitePositiveOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function endText(end) {
  if (end.condition === 'spring') return `spring:${end.springSymbol || ''}`;
  return end.condition;
}

function loadUnitText(type) {
  if (type === 'lineLoad') return 'N/mm';
  if (type === 'areaLoad') return 'N/mm2';
  return 'N;N*mm';
}

const CSV_COLUMNS = 28;

// Flat CSV rendering of the analysis model (one `section` marker column, same
// convention as the quantity CSVs). Values use the same mm-N base system as
// the JSON model.
export function buildAnalysisCSV(state, options = {}) {
  const model = options.model || buildAnalysisModel(state, options);
  const rows = [];
  const push = (...cells) => {
    while (cells.length < CSV_COLUMNS) cells.push('');
    rows.push(cells);
  };

  push('section', 'id', ...Array.from({ length: CSV_COLUMNS - 2 }, (_, index) =>
    String.fromCharCode('a'.charCodeAt(0) + index)
  ));
  push('meta_header', 'key', 'value');
  push('meta', 'format', model.format);
  push('meta', 'version', String(model.version));
  push('meta', 'project_name', model.meta.name);
  push('meta', 'generator_name', model.meta.generator.name);
  push('meta', 'generator_format_version', String(model.meta.generator.formatVersion));
  push('meta', 'generator_app_version', model.meta.generator.appVersion);
  push('meta', 'generated_at', model.meta.generatedAt);
  push('meta', 'vertical_axis', model.meta.coordinates.verticalAxis);
  push('meta', 'handedness', model.meta.coordinates.handedness);
  push('meta', 'node_order', model.meta.nodeOrder);
  push('meta', 'warning_undefined_spring_stiffness', model.meta.warnings.undefinedSpringStiffness ? '1' : '0');
  push('meta', 'warning_undefined_spring_symbols', model.meta.warnings.undefinedSpringSymbols.join(';'));
  push('meta', 'warning_undefined_mass_sources', model.meta.warnings.undefinedMassSources ? '1' : '0');
  push('meta', 'warning_undefined_mass_source_cases', model.meta.warnings.undefinedMassSourceCases.join(';'));
  push('meta', 'warning_undefined_material_properties', model.meta.warnings.undefinedMaterialProperties ? '1' : '0');
  push('meta', 'warning_undefined_material_names', model.meta.warnings.undefinedMaterialNames.join(';'));
  push('unit_header', 'quantity', 'unit');
  for (const [quantity, unit] of Object.entries(model.units)) {
    push('unit', quantity, unit);
  }
  push('node_header', 'id', 'x_mm', 'y_mm', 'z_mm');
  for (const n of model.nodes) {
    push('node', String(n.id), String(n.x), String(n.y), String(n.z));
  }
  push('element_header', 'id', 'type', 'node_i', 'node_j', 'section', 'material',
    'b_mm', 'h_mm', 'end_i', 'end_j', 'roof_role', 'source_id', 'source_branch', 'section_id');
  for (const e of model.elements) {
    push('element', e.id, e.type, String(e.nodeI), String(e.nodeJ),
      e.sectionName || '', e.material,
      e.b === null ? '' : String(e.b), e.h === null ? '' : String(e.h),
      endText(e.endI), endText(e.endJ), e.roofRole || '', e.sourceId, e.sourceBranch,
      e.sectionId ?? '');
  }
  push('sect_header', 'name', 'type', 'material', 'b_mm', 'h_mm', 'A_mm2', 'Iy_mm4', 'Iz_mm4', 'J_mm4', 'is_default',
    'A_source', 'Iy_source', 'Iz_source', 'J_source', 'section_id',
    'shape', 'flange_thickness_mm', 'web_thickness_mm', 'box_thickness_mm',
    'shear_area_ratio_y', 'shear_area_ratio_z', 'Ay_mm2', 'Az_mm2',
    'designation', 'declared_property_source', 'Avy_mm2', 'Avz_mm2');
  for (const s of model.sections) {
    push('sect', s.name, s.type, s.material, String(s.b ?? ''), String(s.h ?? ''),
      String(s.A), String(s.Iy), String(s.Iz), String(s.J), s.isDefault ? '1' : '0',
      s.propertySource.A, s.propertySource.Iy, s.propertySource.Iz, s.propertySource.J,
      s.id, s.shape, String(s.flangeThickness ?? ''), String(s.webThickness ?? ''),
      String(s.boxThickness ?? ''), String(s.shearAreaRatioY ?? ''), String(s.shearAreaRatioZ ?? ''),
      String(s.Ay ?? ''), String(s.Az ?? ''), s.designation, s.declaredPropertySource,
      String(s.Avy ?? ''), String(s.Avz ?? ''));
  }
  push('material_header', 'name', 'E_N_mm2', 'G_N_mm2', 'density_kg_m3', 'is_default');
  for (const material of model.materials) {
    push('material', material.name, String(material.E ?? ''), String(material.G ?? ''),
      String(material.density ?? ''), material.isDefault ? '1' : '0');
  }
  push('spring_header', 'symbol', 'memo', 'kr_N_mm_rad', 'kt_N_mm', 'is_default',
    'krY_N_mm_rad', 'krZ_N_mm_rad');
  for (const s of model.springs) {
    push('spring', s.symbol, s.memo, String(s.kr ?? ''), String(s.kt ?? ''), s.isDefault ? '1' : '0',
      String(s.krY ?? ''), String(s.krZ ?? ''));
  }
  push('support_header', 'id', 'node', 'dx', 'dy', 'dz', 'rx', 'ry', 'rz', 'source_id');
  for (const s of model.supports) {
    push('support', s.id, String(s.nodeId),
      s.dx ? '1' : '0', s.dy ? '1' : '0', s.dz ? '1' : '0',
      s.rx ? '1' : '0', s.ry ? '1' : '0', s.rz ? '1' : '0', s.sourceId);
  }
  push('load_header', 'id', 'type', 'case', 'unit', 'x1', 'y1', 'x2', 'y2', 'value', 'z_mm', 'source_id');
  for (const l of model.loads) {
    const value = l.type === 'pointLoad'
      ? `fx=${l.fx || 0};fy=${l.fy || 0};fz=${l.fz || 0};mx=${l.mx || 0};my=${l.my || 0};mz=${l.mz || 0}`
      : String(l.value ?? 0);
    push('load', l.id, l.type, l.loadCase, loadUnitText(l.type),
      String(l.x1 ?? ''), String(l.y1 ?? ''), String(l.x2 ?? ''), String(l.y2 ?? ''),
      value, String(l.z), l.sourceId);
  }
  push('mass_source_header', 'load_case', 'factor');
  for (const loadCase of model.loadCases) {
    push('mass_source', loadCase, String(model.massSources[loadCase] ?? ''));
  }
  push('self_weight_header', 'mode', 'is_default');
  push('self_weight', model.selfWeight.mode, model.selfWeight.isDefault ? '1' : '0');
  push('combo_header', 'id', 'name', 'factors');
  for (const c of model.loadCombinations) {
    const factors = Object.entries(c.factors).map(([k, v]) => `${k}=${v}`).join(';');
    push('combo', c.id, c.name, factors);
  }
  return `${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

function csvCell(value) {
  const text = String(value ?? '');
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}
