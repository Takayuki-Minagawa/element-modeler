// io.js - JSON/CSV/DXF/PNG Export / Import

import { buildAnalysisCSV, buildAnalysisModel } from './analysis-export.js';
import { buildDXF, parseDXF } from './dxf.js';
import { applyModelImport } from './persistence/model-import.js';
import {
  computeMemberLengthM,
  computeMemberSchedule,
  computeQuantitySummary,
  computeSurfaceSeismicWeightN,
  computeSurfaceWeightAreaM2,
  computeSurfaceWindProjectionM2,
} from './quantities.js';

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadJson(filename, data) {
  const json = JSON.stringify(data, null, 2);
  downloadBlob(filename, new Blob([json], { type: 'application/json' }));
}

function downloadCsv(filename, csv) {
  downloadBlob(filename, new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }));
}

export function exportJSON(state) {
  const data = state.toJSON();
  downloadJson(`${data.meta.name || 'lineframe'}_${timestamp()}.json`, data);
}

export function buildQuantitySummaryCSV(state) {
  const summary = computeQuantitySummary(state);
  const rows = [
    ['section', 'name', 'wind_x_area_m2', 'wind_y_area_m2', 'seismic_weight_N', 'member_count', 'member_length_m'],
  ];
  for (const row of summary.levels) {
    rows.push([
      'level',
      row.label,
      formatCsvNumber(row.windXAreaM2),
      formatCsvNumber(row.windYAreaM2),
      formatCsvNumber(row.seismicWeightN),
      '',
      '',
    ]);
  }
  rows.push([
    'total',
    'total',
    formatCsvNumber(summary.totals.windXAreaM2),
    formatCsvNumber(summary.totals.windYAreaM2),
    formatCsvNumber(summary.totals.seismicWeightN),
    '',
    '',
  ]);
  for (const row of summary.roofMembers.rows) {
    rows.push([
      'roof_member',
      row.roofRole,
      '',
      '',
      '',
      String(row.count),
      formatCsvNumber(row.lengthM),
    ]);
  }
  rows.push([
    'roof_member_total',
    'total',
    '',
    '',
    '',
    String(summary.roofMembers.totals.count),
    formatCsvNumber(summary.roofMembers.totals.lengthM),
  ]);
  return `${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

export function exportQuantitySummaryCSV(state) {
  const name = state.meta?.name || 'lineframe';
  downloadCsv(`${name}_quantities_${timestamp()}.csv`, buildQuantitySummaryCSV(state));
}

export function buildQuantityDetailCSV(state) {
  const rows = [
    [
      'section',
      'id',
      'type',
      'level',
      'include_wind',
      'include_seismic_weight',
      'unit_weight',
      'wind_x_area_m2',
      'wind_y_area_m2',
      'weight_area_m2',
      'seismic_weight_N',
      'roof_role',
      'member_length_m',
    ],
  ];
  for (const surface of state.surfaces || []) {
    const wind = surface.includeWind !== false
      ? computeSurfaceWindProjectionM2(state, surface)
      : { xAreaM2: 0, yAreaM2: 0 };
    const weightArea = computeSurfaceWeightAreaM2(state, surface);
    const seismicWeight = surface.includeSeismicWeight
      ? computeSurfaceSeismicWeightN(state, surface)
      : 0;
    rows.push([
      'surface',
      surface.id || '',
      surface.type || '',
      surface.levelId || '',
      surface.includeWind !== false ? 'true' : 'false',
      surface.includeSeismicWeight ? 'true' : 'false',
      formatCsvNumber(surface.unitWeight),
      formatCsvNumber(wind.xAreaM2),
      formatCsvNumber(wind.yAreaM2),
      formatCsvNumber(weightArea),
      formatCsvNumber(seismicWeight),
      '',
      '',
    ]);
  }
  for (const member of state.members || []) {
    if (!member.roofRole) continue;
    rows.push([
      'roof_member',
      member.id || '',
      member.type || '',
      member.levelId || '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      member.roofRole,
      formatCsvNumber(computeMemberLengthM(state, member)),
    ]);
  }
  return `${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

export function exportQuantityDetailCSV(state) {
  const name = state.meta?.name || 'lineframe';
  downloadCsv(`${name}_quantity_details_${timestamp()}.csv`, buildQuantityDetailCSV(state));
}

/**
 * Member schedule CSV: one `schedule` row per (type, section), a `total` row and
 * one `member` row per line member. Weight cells stay blank when the section
 * area or material density is unknown.
 */
export function buildMemberScheduleCSV(state) {
  const schedule = computeMemberSchedule(state);
  const cell = value => (value === null ? '' : formatCsvNumber(value)); // unknown weights stay blank, never 0
  const rows = [
    ['section', 'type', 'section_name', 'material', 'area_mm2', 'density_kg_m3', 'unit_weight_kg_m',
      'count', 'length_m', 'weight_kg', 'id', 'level', 'roof_role'],
  ];
  for (const row of schedule.rows) {
    rows.push([
      'schedule', row.type, row.sectionName, row.material,
      cell(row.areaMm2), cell(row.density), cell(row.unitWeightKgPerM),
      String(row.count), formatCsvNumber(row.lengthM), cell(row.weightKg), '', '', '',
    ]);
  }
  rows.push([
    'total', '', '', '', '', '', '',
    String(schedule.totals.count), formatCsvNumber(schedule.totals.lengthM), formatCsvNumber(schedule.totals.weightKg),
    '', '', '',
  ]);
  for (const row of schedule.members) {
    rows.push([
      'member', row.type, row.sectionName, '', '', '', '', '',
      formatCsvNumber(row.lengthM), cell(row.weightKg), row.id, row.levelId, row.roofRole,
    ]);
  }
  return `${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

export function exportMemberScheduleCSV(state) {
  const name = state.meta?.name || 'lineframe';
  downloadCsv(`${name}_member_schedule_${timestamp()}.csv`, buildMemberScheduleCSV(state));
}

export function exportAnalysisJSON(state, options = {}) {
  const name = state.meta?.name || 'lineframe';
  downloadJson(`${name}_analysis_${timestamp()}.json`, options.model || buildAnalysisModel(state));
}

export function exportAnalysisCSV(state, options = {}) {
  const name = state.meta?.name || 'lineframe';
  downloadCsv(`${name}_analysis_${timestamp()}.csv`, buildAnalysisCSV(state, options));
}

export function exportDXF(state, options = {}) {
  const name = state.meta?.name || 'lineframe';
  const dxf = buildDXF(state, options);
  downloadBlob(`${name}_plan_${timestamp()}.dxf`, new Blob([dxf], { type: 'application/dxf' }));
}

export function exportCanvasPNG(canvas, state) {
  const name = state.meta?.name || 'lineframe';
  canvas.toBlob(blob => {
    if (blob) downloadBlob(`${name}_plan_${timestamp()}.png`, blob);
  }, 'image/png');
}

// Reads a DXF file and installs it as the drawing underlay.
export function importDXFUnderlay(file, state) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const { entities } = parseDXF(reader.result);
        if (!entities.length) {
          reject(new Error('No drawable entities found'));
          return;
        }
        state.setUnderlay({ name: file.name, entities });
        resolve({ count: entities.length });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function importJSON(file, state, history) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        applyModelImport(data, state, history);
        resolve(data);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function exportUserDefs(state) {
  const sections = state.sectionCatalog.filter(s => !s.isDefault).map(s => cloneSectionDefinition(s));
  const springs = state.springCatalog.filter(s => !s.isDefault).map(s => ({ ...s }));
  const materials = state.materialCatalog.filter(material => !material.isDefault).map(material => ({ ...material }));
  if (sections.length === 0 && springs.length === 0 && materials.length === 0) return false;

  const data = { userDefinitions: true, materials, sections, springs };
  downloadJson(`user_definitions_${timestamp()}.json`, data);
  return true;
}

function cloneSectionDefinition(section) {
  return {
    ...section,
    defaultEndI: section.defaultEndI ? { ...section.defaultEndI } : undefined,
    defaultEndJ: section.defaultEndJ ? { ...section.defaultEndJ } : undefined,
  };
}

export function importUserDefs(file, state) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data.userDefinitions) {
          reject(new Error('Not a user definition file'));
          return;
        }
        let added = 0;
        let skipped = 0;
        if (Array.isArray(data.materials)) {
          for (const entry of data.materials) {
            if (entry.isDefault) continue;
            const existing = state.getMaterial(entry.name);
            const result = existing?.isDefault
              ? state.updateMaterial(entry.name, entry)
              : state.addMaterial(entry);
            if (result) { added++; } else { skipped++; }
          }
        }
        if (Array.isArray(data.springs)) {
          for (const entry of data.springs) {
            if (entry.isDefault) continue;
            const result = state.addSpring(entry);
            if (result) { added++; } else { skipped++; }
          }
        }
        if (Array.isArray(data.sections)) {
          for (const entry of data.sections) {
            if (entry.isDefault) continue;
            const result = state.addSection(entry);
            if (result) { added++; } else { skipped++; }
          }
        }
        resolve({ added, skipped });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function timestamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function csvCell(value) {
  const text = String(value ?? '');
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function formatCsvNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return String(Number(n.toFixed(6)));
}

function pad(n) {
  return String(n).padStart(2, '0');
}
