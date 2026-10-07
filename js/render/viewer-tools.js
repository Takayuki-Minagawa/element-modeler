// Optional standalone UI. Parent supplies its host and routes errors to notices.
// No dependency on app.js, i18n.js, or a particular toolbar layout.
import { mountViewerToolsPanel } from './viewer-tools-panel.js';

export function mountViewerTools(host, viewer, { language = 'en', onError = console.error } = {}) {
  const ja = language === 'ja';
  const doc = host.ownerDocument;
  const root = doc.createElement('fieldset');
  const legend = doc.createElement('legend');
  legend.textContent = ja ? '3D表示・出力' : '3D view and export';
  legend.className = 'sr-only';
  root.append(legend);
  const listeners = [];
  const listen = (el, type, handler) => { el.addEventListener(type, handler); listeners.push(() => el.removeEventListener(type, handler)); };
  const label = (text, control) => {
    const el = doc.createElement('label');
    el.append(doc.createTextNode(text), control);
    root.append(el);
  };
  const axis = doc.createElement('select');
  for (const [value, text] of [['', ja ? '解除' : 'Off'], ['X', 'X'], ['Y', 'Y'], ['Z', 'Z']]) {
    const option = doc.createElement('option'); option.value = value; option.textContent = text; axis.append(option);
  }
  label(ja ? '切断軸 ' : 'Clip axis ', axis);
  const slider = doc.createElement('input');
  slider.type = 'range'; slider.step = 'any';
  slider.setAttribute('aria-label', ja ? '切断位置スライダー (mm)' : 'Clipping position slider (mm)');
  const position = doc.createElement('input');
  position.type = 'number'; position.step = 'any'; position.required = true;
  position.className = 'viewer-clip-position';
  label(ja ? '位置 (mm) ' : 'Position (mm) ', position);
  root.append(slider);
  const flip = doc.createElement('input'); flip.type = 'checkbox';
  label(ja ? '反転 ' : 'Flip ', flip);
  const button = (text, action, parent = root) => {
    const el = doc.createElement('button'); el.type = 'button'; el.textContent = text;
    listen(el, 'click', action); parent.append(el); return el;
  };
  const status = doc.createElement('output');
  status.setAttribute('aria-live', 'polite');
  const navigation = doc.createElement('div');
  navigation.className = 'viewer-navigation';
  const fit = button(ja ? '全体表示' : 'Fit all', () => {
    status.textContent = viewer.focusAll() ? '' : (ja ? '表示中の要素がありません' : 'No displayed elements');
  }, navigation);
  fit.dataset.viewerAction = 'fit-all';
  fit.title = ja ? '表示中のモデル全体を収める（3D画面でHome）' : 'Frame displayed elements (Home in the 3D view)';
  const presets = doc.createElement('div');
  presets.className = 'viewer-view-presets';
  presets.setAttribute('role', 'group');
  presets.setAttribute('aria-label', ja ? '表示方向' : 'View direction');
  for (const [preset, text] of [['oblique', ja ? '斜め' : 'Oblique'], ['top', ja ? '上' : 'Top'],
    ['front', ja ? '正面' : 'Front'], ['right', ja ? '右' : 'Right']]) {
    const el = button(text, () => {
      status.textContent = viewer.setViewPreset(preset) ? '' : (ja ? '表示中の要素がありません' : 'No displayed elements');
    }, presets);
    el.dataset.viewPreset = preset;
  }
  const hint = doc.createElement('small');
  hint.textContent = ja
    ? '左ドラッグ：回転 / 右ドラッグ：移動 / ホイール：カーソル位置へズーム。3D画面でHome：全体、F：選択へ移動。'
    : 'Left drag: orbit / right drag: pan / wheel: zoom to cursor. In the 3D view, Home: fit all, F: focus selection.';
  navigation.append(presets, hint);
  root.insertBefore(navigation, legend.nextSibling);
  const apply = () => {
    if (axis.value) viewer.setClipping(axis.value, Number(slider.value), flip.checked);
    else viewer.clearClipping();
    position.value = axis.value ? slider.value : '';
    status.textContent = '';
  };
  const refresh = () => {
    const clip = viewer.clipping;
    axis.value = clip?.axis || '';
    flip.checked = clip?.flipped || false;
    slider.disabled = position.disabled = flip.disabled = !axis.value;
    if (axis.value) {
      const range = viewer.getClippingRange(axis.value);
      // Keep a valid plane outside new model bounds after an import/undo.
      slider.min = Math.min(range.min, clip.positionMm);
      slider.max = Math.max(range.max, clip.positionMm, Number(slider.min) + 1);
      slider.value = clip.positionMm;
      position.min = slider.min;
      position.max = slider.max;
    }
    position.value = clip ? String(clip.positionMm) : '';
  };
  listen(axis, 'change', () => {
    if (axis.value) {
      const range = viewer.getClippingRange(axis.value);
      slider.min = range.min; slider.max = Math.max(range.max, range.min + 1);
      slider.value = (range.min + range.max) / 2;
    }
    apply();
    refresh();
  });
  listen(slider, 'input', apply); listen(flip, 'change', apply);
  const commitPosition = () => {
    if (position.disabled) return;
    if (!position.checkValidity() || !Number.isFinite(position.valueAsNumber)) {
      status.textContent = ja ? '切断位置は表示範囲内の数値を入力してください' : 'Enter a clipping position within the displayed range';
      refresh();
      return;
    }
    slider.value = position.value;
    apply();
  };
  listen(position, 'change', commitPosition);
  listen(position, 'keydown', event => {
    if (event.isComposing || event.key !== 'Enter') return;
    event.preventDefault();
    commitPosition();
  });
  button(ja ? '選択を単独表示' : 'Isolate selection', () => {
    status.textContent = viewer.isolateSelection() ? '' : (ja ? '表示中の要素を選択してください' : 'Select a displayed element first');
  });
  button(ja ? '単独表示を解除' : 'Clear isolation', () => { viewer.clearIsolation(); status.textContent = ''; });
  button(ja ? '選択へ移動' : 'Focus selection', () => {
    status.textContent = viewer.focusSelection() ? '' : (ja ? '表示中の要素を選択してください' : 'Select a displayed element first');
  });
  let disposed = false;
  let downloadUrl = null;
  const exportButton = button(ja ? 'GLB出力' : 'Export GLB', async () => {
    exportButton.disabled = true;
    try {
      const binary = await viewer.exportGLB();
      if (disposed) return;
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
      downloadUrl = URL.createObjectURL(new Blob([binary], { type: 'model/gltf-binary' }));
      const anchor = doc.createElement('a');
      anchor.href = downloadUrl; anchor.download = 'element-model.glb';
      root.append(anchor); anchor.click(); anchor.remove();
    } catch (error) {
      if (!disposed) onError(error);
    } finally { if (!disposed) exportButton.disabled = false; }
  });
  const note = doc.createElement('small');
  note.textContent = ja ? '表示対象をm単位で出力。切断面は開口、色は元の要素色。' : 'Exports displayed elements in meters, with open cut faces and original element colors.';
  root.append(status, note);
  const panel = mountViewerToolsPanel(host, root, { title: legend.textContent, language });
  refresh();
  return { refresh, dispose() {
    disposed = true;
    for (const remove of listeners) remove();
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    panel.dispose();
  } };
}
