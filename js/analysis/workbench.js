import { buildAnalysisModel } from '../analysis-export.js';
import { getLang } from '../i18n.js';
import { modelFingerprint } from './fingerprint.js';
import { previewLineLoad, previewRectangularSlab } from './load-distribution.js';
import { mountLoadPreview, mountResultsPanel } from './panels.js';
import { FORCE_COMPONENTS } from './results.js';

// The supported load subset has an explicit vertical sign and explicit targets.
export function previewModelLoad(model, loadId, { elementIds, spanAxis = 'x', sign = -1 }) {
  const load = model.loads.find(item => item.id === loadId);
  if (!load || ![-1, 1].includes(sign)) throw new Error('Choose a load and vertical direction');
  const common = { sourceId: load.sourceId, loadCase: load.loadCase };
  if (load.type === 'lineLoad') {
    return previewLineLoad(model, { ...common, elementId: elementIds[0],
      start: [load.x1, load.y1, load.z], end: [load.x2, load.y2, load.z], intensity: [0, 0, sign * load.value] });
  }
  if (load.type === 'areaLoad') {
    return previewRectangularSlab(model, { ...common, rectangle: { x1: load.x1, y1: load.y1, x2: load.x2, y2: load.y2, z: load.z },
      spanAxis, edgeElementIds: elementIds, pressure: sign * load.value });
  }
  throw new Error('Only line loads and rectangular area loads are supported');
}

export async function distributedAnalysisModel(model, loadId, pointLoads) {
  if (!model.loads.some(load => load.id === loadId) || !pointLoads.length) throw new Error('Missing original load or assigned loads');
  const output = structuredClone(model);
  output.meta.sourceModelFingerprint = await modelFingerprint(model);
  const remaining = output.loads.filter(load => load.id !== loadId);
  output.loads = [...remaining, ...pointLoads].map((load, index) => ({ ...load, id: index + 1 }));
  return output;
}

export async function validateReferenceModel(current, candidate) {
  const expected = await modelFingerprint(current);
  if (candidate?.format !== 'element-modeler-analysis' || candidate.version !== 2) throw new Error('Unsupported reference model');
  if (await modelFingerprint(candidate) === expected) return expected;
  if (candidate.meta?.sourceModelFingerprint !== expected) throw new Error('Reference model does not match the current CAD model');
  // A distribution export may change loads only. An unchanged source stamp
  // cannot authorize changed topology, coordinates, materials or restraints.
  const original = structuredClone(candidate);
  delete original.meta.sourceModelFingerprint;
  original.loads = current.loads;
  if (await modelFingerprint(original) !== expected) throw new Error('Reference geometry or analysis properties differ');
  return expected;
}

export function initAnalysisWorkbench({ state, host, onSelect = () => {} }) {
  const doc = host.ownerDocument;
  const text = (ja, en) => getLang() === 'ja' ? ja : en;
  const make = (tag, parent, content) => {
    const el = doc.createElement(tag);
    if (content !== undefined) el.textContent = content;
    parent?.append(el);
    return el;
  };
  const openButton = make('button', host);
  openButton.type = 'button'; openButton.id = 'btn-analysis-workbench';
  const dialog = make('dialog', doc.body);
  dialog.className = 'analysis-workbench';
  dialog.addEventListener('keydown', event => event.stopPropagation());
  const heading = make('h2', dialog);
  heading.id = 'analysis-workbench-title';
  dialog.setAttribute('aria-labelledby', heading.id);
  const intro = make('p', dialog);
  const close = make('button', dialog);
  close.type = 'button'; close.addEventListener('click', () => dialog.close());
  const controls = make('div', dialog);
  const status = make('p', dialog); status.setAttribute('role', 'status');
  const output = make('div', dialog); output.className = 'analysis-output';
  let activePanel = null, originalFingerprint = null, lastRevision = state.revision;
  let serial = 0, downloadURL = null, verifiedReference = null, quarantinedReference = null, lastResult = null;
  const captureRequest = () => ({ serial, revision: state.revision });
  // Check synchronously after the last await: a digest describes its input
  // snapshot, not necessarily the model that exists when it resolves.
  const isCurrent = request => request.serial === serial && request.revision === state.revision;
  const disposePanel = () => { serial++; activePanel?.dispose(); activePanel = null; output.replaceChildren(); };
  const clearReference = () => { verifiedReference = null; quarantinedReference = null; };
  const clear = () => { disposePanel(); originalFingerprint = null; lastResult = null; clearReference(); status.textContent = ''; };
  dialog.addEventListener('close', () => { serial++; });
  const error = cause => { status.textContent = text('処理できません: ', 'Cannot continue: ') + cause.message; };
  const downloadFile = (name, parts, type) => {
    if (downloadURL) URL.revokeObjectURL(downloadURL);
    downloadURL = URL.createObjectURL(new Blob(parts, { type }));
    const anchor = make('a', dialog);
    anchor.href = downloadURL; anchor.download = name; anchor.click(); anchor.remove();
  };
  const download = model => downloadFile('distributed-analysis.json', [JSON.stringify(model, null, 2)], 'application/json');
  const downloadForces = (csv, loadCase) =>
    downloadFile(`member-forces-${String(loadCase).replace(/[^\p{L}\p{N}.-]+/gu, '_')}.csv`, ['\ufeff', csv], 'text/csv;charset=utf-8');
  const selectControl = (label, options, id) => {
    const wrapper = make('label', controls, label);
    const select = make('select', wrapper); select.id = id;
    options.forEach(([value, name]) => { const option = make('option', select, name); option.value = value; });
    return select;
  };
  const fileControl = (label, id) => {
    const wrapper = make('label', controls, label);
    const input = make('input', wrapper); input.type = 'file'; input.accept = '.json'; input.id = id;
    return input;
  };
  function renderControls() {
    controls.replaceChildren();
    const model = buildAnalysisModel(state);
    const loadSelect = selectControl(text('配分する荷重', 'Load to distribute'), model.loads.filter(load => load.type !== 'pointLoad')
      .map(load => [load.id, `${load.sourceId} · ${load.type} · ${load.loadCase}`]), 'distribution-load');
    const members = model.elements.map(e => [e.id, `${e.sourceId}/${e.sourceBranch} (${e.id})`]);
    const first = selectControl(text('作用部材 / 支持辺1', 'Target member / edge 1'), members, 'distribution-first');
    const second = selectControl(text('支持辺2（面荷重）', 'Edge 2 (area load)'), members, 'distribution-second');
    if (members.length > 1) second.value = members[1][0];
    const axis = selectControl(text('一方向スパン', 'One-way span'), [['x', 'X'], ['y', 'Y']], 'distribution-axis');
    const sign = selectControl(text('荷重値に掛ける向き', 'Direction multiplier'), [[-1, '-Z'], [1, '+Z']], 'distribution-sign');
    const preview = make('button', controls, text('配分を確認', 'Preview assignment'));
    preview.type = 'button'; preview.id = 'btn-load-preview';
    preview.addEventListener('click', async () => {
      disposePanel(); status.textContent = '';
      const request = captureRequest();
      try {
        const current = buildAnalysisModel(state);
        const loadId = Number(loadSelect.value);
        const options = { elementIds: [Number(first.value), Number(second.value)], spanAxis: axis.value, sign: Number(sign.value) };
        const fingerprint = await modelFingerprint(current);
        if (!isCurrent(request)) return;
        const latestFingerprint = await modelFingerprint(buildAnalysisModel(state));
        if (!isCurrent(request) || fingerprint !== latestFingerprint) return;
        const view = previewModelLoad(current, loadId, options);
        originalFingerprint = fingerprint;
        activePanel = mountLoadPreview(output, view, { language: getLang(), onSelect,
          onExport: async pointLoads => {
            const exportRequest = captureRequest();
            try {
              const latestFingerprint = await modelFingerprint(buildAnalysisModel(state));
              if (!isCurrent(exportRequest)) return;
              if (fingerprint !== latestFingerprint) throw new Error('Model changed; regenerate the preview');
              const distributed = await distributedAnalysisModel(current, loadId, pointLoads);
              if (!isCurrent(exportRequest)) return;
              download(distributed);
            } catch (cause) { if (isCurrent(exportRequest)) error(cause); }
          },
        });
      } catch (cause) { if (isCurrent(request)) error(cause); }
    });
    make('hr', controls);
    const reference = fileControl(text('配分済み解析JSON（任意）', 'Distributed analysis JSON (optional)'), 'analysis-reference-file');
    reference.addEventListener('change', async () => {
      const file = reference.files[0]; if (!file) return;
      reference.value = '';
      disposePanel(); lastResult = null; clearReference(); originalFingerprint = null; status.textContent = '';
      const request = captureRequest();
      try {
        const current = buildAnalysisModel(state);
        const candidate = JSON.parse(await file.text());
        if (!isCurrent(request)) return;
        const fingerprint = await validateReferenceModel(current, candidate);
        if (!isCurrent(request)) return;
        verifiedReference = { model: candidate, fingerprint }; originalFingerprint = fingerprint;
        status.textContent = text('解析モデルを照合しました。', 'Reference model verified.');
      } catch (cause) { if (isCurrent(request)) error(cause); }
    });
    const resultFile = fileControl(text('解析結果JSON', 'Analysis result JSON'), 'analysis-result-file');
    const plane = selectControl(text('表示面', 'Projection'), [['xz', 'XZ'], ['yz', 'YZ'], ['xy', 'XY']], 'analysis-result-plane');
    const component = selectControl(text('応力図', 'Force diagram'),
      [['none', text('なし', 'None')], ...FORCE_COMPONENTS.map(c => [c, c])], 'analysis-result-component');
    const scaleLabel = make('label', controls, text('変形倍率', 'Deformation scale'));
    const scale = make('input', scaleLabel); scale.type = 'number'; scale.min = '0'; scale.value = '1'; scale.id = 'analysis-result-scale';
    const renderResult = async () => {
      if (!lastResult) return;
      disposePanel(); const request = captureRequest();
      let panel = null;
      try {
        const current = buildAnalysisModel(state);
        const reference = verifiedReference?.model || current;
        const result = lastResult;
        const options = { language: getLang(), scale: Number(scale.value), plane: plane.value, component: component.value,
          onSelect, onExportForces: downloadForces };
        const fingerprint = await modelFingerprint(current);
        if (!isCurrent(request)) return;
        if (reference !== current) await validateReferenceModel(current, reference);
        if (!isCurrent(request)) return;
        const staging = doc.createElement('div');
        panel = await mountResultsPanel(staging, reference, result, options);
        if (!isCurrent(request)) return;
        const latestFingerprint = await modelFingerprint(buildAnalysisModel(state));
        if (!isCurrent(request) || fingerprint !== latestFingerprint) return;
        output.append(staging); activePanel = panel; originalFingerprint = fingerprint; status.textContent = '';
        panel = null; // Ownership transferred to activePanel.
      } catch (cause) { if (isCurrent(request)) error(cause); }
      finally { panel?.dispose(); }
    };
    resultFile.addEventListener('change', async () => {
      const file = resultFile.files[0]; if (!file) return;
      resultFile.value = '';
      disposePanel(); lastResult = null; status.textContent = ''; const request = captureRequest();
      try {
        const parsed = JSON.parse(await file.text());
        if (!isCurrent(request)) return;
        lastResult = parsed; await renderResult();
      }
      catch (cause) { if (isCurrent(request)) { disposePanel(); error(cause); } }
    });
    scale.addEventListener('change', renderResult); plane.addEventListener('change', renderResult);
    component.addEventListener('change', renderResult);
  }
  function applyLanguage() {
    openButton.textContent = text('解析結果・荷重配分', 'Results / load assignment');
    heading.textContent = openButton.textContent;
    intro.textContent = text('線材の線形静的解析結果と、一方向矩形床・単一部材の荷重配分を確認します。荷重配分はCADを変更せず、解析JSONを書き出します。',
      'Inspect linear static frame results and one-way rectangular/slender-member load assignments. Distribution exports analysis JSON without modifying the CAD model.');
    close.textContent = text('閉じる', 'Close');
  }
  openButton.addEventListener('click', () => { clear(); applyLanguage(); renderControls(); dialog.showModal(); });
  applyLanguage();
  return {
    applyLanguage,
    refresh() {
      if (lastRevision === state.revision) return;
      lastRevision = state.revision;
      serial++;
      const request = captureRequest();
      // Retain the private candidate across overlapping refreshes, but never
      // render against it until the latest revision confirms its source hash.
      quarantinedReference = verifiedReference || quarantinedReference;
      verifiedReference = null;
      const candidate = quarantinedReference;
      if (!originalFingerprint) return;
      const expected = originalFingerprint;
      return modelFingerprint(buildAnalysisModel(state)).then(fingerprint => {
        if (!isCurrent(request) || originalFingerprint !== expected) return;
        if (fingerprint !== expected) {
          clear(); status.textContent = text('モデルを変更したため再読込・再配分してください。', 'Model changed; reload results or regenerate the preview.');
        } else {
          verifiedReference = candidate?.fingerprint === fingerprint ? candidate : null;
          quarantinedReference = null;
        }
      }).catch(cause => { if (isCurrent(request)) { clear(); error(cause); } });
    },
    dispose() { clear(); if (downloadURL) URL.revokeObjectURL(downloadURL); dialog.remove(); openButton.remove(); },
  };
}
