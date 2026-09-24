import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { AppState } from '../js/state.js';
import { buildMemberScheduleCSV, buildQuantityDetailCSV, buildQuantitySummaryCSV } from '../js/io.js';

test('quantity summary CSV includes level totals and roof member rows', () => {
  const state = new AppState();
  state.addSurfaceRect(0, 0, 5000, 4000, {
    type: 'roof',
    levelId: 'L1',
    roofSlope: 0.3,
    roofDirection: 'xPlus',
    includeWind: true,
    includeSeismicWeight: true,
    unitWeight: 500,
  });
  const n1 = state.addNode(0, 0);
  const n2 = state.addNode(3000, 4000);
  state.addMember(n1.id, n2.id, {
    type: 'beam',
    levelId: 'L1',
    geometryMode: 'explicit3d',
    startZ: 2800,
    endZ: 2800,
    roofRole: 'roofEdge',
  });

  const csv = buildQuantitySummaryCSV(state);

  assert.match(csv, /^section,name,wind_x_area_m2,wind_y_area_m2,seismic_weight_N,member_count,member_length_m\r\n/);
  assert.match(csv, /level,2F \(z=2800\),6,0,10440\.306509,,/);
  assert.match(csv, /total,total,6,0,10440\.306509,,/);
  assert.match(csv, /roof_member,roofEdge,,,,1,5/);
  assert.match(csv, /roof_member_total,total,,,,1,5/);
});

test('quantity summary CSV export is wired to the UI', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const appSource = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  const i18nSource = await readFile(new URL('../js/i18n.js', import.meta.url), 'utf8');

  assert.match(html, /id="btn-quantity-export"/);
  assert.match(html, /data-i18n="quantityCsvExport"/);
  assert.match(appSource, /exportQuantitySummaryCSV/);
  assert.match(appSource, /btn-quantity-export/);
  assert.match(i18nSource, /quantityCsvExported/);
});

test('quantity detail CSV includes surface and roof member rows', () => {
  const state = new AppState();
  const roof = state.addSurfaceRect(0, 0, 5000, 4000, {
    type: 'roof',
    levelId: 'L1',
    roofSlope: 0.3,
    roofDirection: 'xPlus',
    includeWind: true,
    includeSeismicWeight: true,
    unitWeight: 500,
  });
  const n1 = state.addNode(0, 0);
  const n2 = state.addNode(3000, 4000);
  const member = state.addMember(n1.id, n2.id, {
    type: 'beam',
    levelId: 'L1',
    geometryMode: 'explicit3d',
    startZ: 2800,
    endZ: 2800,
    roofRole: 'roofEdge',
  });

  const csv = buildQuantityDetailCSV(state);

  assert.match(csv, /^section,id,type,level,include_wind,include_seismic_weight,unit_weight,wind_x_area_m2,wind_y_area_m2,weight_area_m2,seismic_weight_N,roof_role,member_length_m\r\n/);
  assert.match(csv, new RegExp(`surface,${roof.id},roof,L1,true,true,500,6,0,20\\.880613,10440\\.306509,,`));
  assert.match(csv, new RegExp(`roof_member,${member.id},beam,L1,,,,,,,,roofEdge,5`));
});

test('quantity detail CSV export is wired to the UI', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const appSource = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  const i18nSource = await readFile(new URL('../js/i18n.js', import.meta.url), 'utf8');

  assert.match(html, /id="btn-quantity-detail-export"/);
  assert.match(html, /data-i18n="quantityDetailCsvExport"/);
  assert.match(appSource, /exportQuantityDetailCSV/);
  assert.match(appSource, /btn-quantity-detail-export/);
  assert.match(i18nSource, /quantityDetailCsvExported/);
});

test('member schedule CSV lists section groups, a total row and member rows', () => {
  const state = new AppState();
  const n1 = state.addNode(0, 0);
  const n2 = state.addNode(6000, 0);
  const beam = state.addMember(n1.id, n2.id, { type: 'beam', levelId: 'L1' });
  const column = state.addMember(n1.id, n1.id, { type: 'column', levelId: 'L0', topLevelId: 'L1' });
  state.addSection({ target: 'member', type: 'beam', name: 'NoMaterial', material: 'missing', b: 100, h: 100 });
  const unknown = state.addMember(n1.id, n2.id, { type: 'beam', levelId: 'L1', sectionName: 'NoMaterial' });

  const csv = buildMemberScheduleCSV(state);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'section,type,section_name,material,area_mm2,density_kg_m3,unit_weight_kg_m,count,length_m,weight_kg,id,level,roof_role');
  assert.equal(lines[1], 'schedule,column,_C,steel,11025,7850,86.54625,1,2.8,242.3295,,,');
  assert.equal(lines[2], 'schedule,beam,_G,steel,80000,7850,628,1,6,3768,,,');
  assert.equal(lines[3], 'schedule,beam,NoMaterial,missing,10000,,,1,6,,,,');
  assert.equal(lines[4], 'total,,,,,,,3,14.8,4010.3295,,,');
  assert.equal(lines[5], `member,beam,_G,,,,,,6,3768,${beam.id},L1,`);
  assert.equal(lines[6], `member,column,_C,,,,,,2.8,242.3295,${column.id},L0,`);
  assert.equal(lines[7], `member,beam,NoMaterial,,,,,,6,,${unknown.id},L1,`);
  assert.equal(lines[8], '');
});

test('member schedule CSV export is wired to the UI', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const appSource = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  const i18nSource = await readFile(new URL('../js/i18n.js', import.meta.url), 'utf8');
  const uiSource = await readFile(new URL('../js/ui.js', import.meta.url), 'utf8');

  assert.match(html, /id="btn-member-schedule-export"/);
  assert.match(html, /data-i18n="memberScheduleCsvExport"/);
  assert.match(appSource, /exportMemberScheduleCSV/);
  assert.match(appSource, /btn-member-schedule-export/);
  assert.match(i18nSource, /memberScheduleCsvExported/);
  assert.match(uiSource, /computeMemberSchedule\(this\.state\)/);
  assert.match(uiSource, /quantity-schedule-table/);
});
