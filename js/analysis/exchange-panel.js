import { getLang } from '../i18n.js';
import {
  detachAnalysisExchange,
  exchangeStatus,
  exportExchange,
  exportNativeAnalysisModel,
  importAnalysisExchange,
} from './exchange-binding.js';

// The exchange retains the original solver model separately from editable CAD.
// Every async operation is tied to the current dialog request and CAD revision.
export function initAnalysisExchangePanel({ state, history, host, onModelChange = () => {} }) {
  const doc = host.ownerDocument;
  const text = (ja, en) => getLang() === 'ja' ? ja : en;
  const make = (tag, parent, id) => {
    const element = doc.createElement(tag);
    if (id) element.id = id;
    parent.append(element);
    return element;
  };
  const button = (parent, id) => {
    const element = make('button', parent, id);
    element.type = 'button';
    return element;
  };
  const openButton = button(host, 'btn-analysis-exchange');
  const dialog = make('dialog', doc.body, 'analysis-exchange-dialog');
  dialog.className = 'analysis-exchange';
  dialog.addEventListener('keydown', event => event.stopPropagation());
  const heading = make('h2', dialog, 'analysis-exchange-title');
  dialog.setAttribute('aria-labelledby', heading.id);
  const intro = make('p', dialog);
  const validationHint = make('p', dialog);
  const fileLabel = make('label', dialog);
  const fileText = make('span', fileLabel);
  const fileInput = make('input', fileLabel, 'analysis-exchange-file');
  fileInput.type = 'file'; fileInput.accept = '.json,application/json';
  const binding = make('p', dialog, 'analysis-exchange-binding');
  const summary = make('dl', dialog, 'analysis-exchange-summary');
  const actions = make('div', dialog); actions.className = 'analysis-exchange-actions';
  const archiveButton = button(actions, 'btn-exchange-save');
  const nativeButton = button(actions, 'btn-exchange-native');
  const detachButton = button(actions, 'btn-exchange-detach');
  const closeButton = button(actions, 'btn-exchange-close');
  const notice = make('p', dialog, 'analysis-exchange-notice');
  notice.setAttribute('role', 'status');

  let operation = 0, display = 0, lastRevision = state.revision;
  let disposed = false, busy = false, currentStatus = 'none', downloadURL = null;
  const capture = () => ({ operation, revision: state.revision, original: state.analysisExchange });
  const active = request => !disposed && dialog.open && request.operation === operation;
  const current = request => active(request) && request.revision === state.revision && request.original === state.analysisExchange;
  function buttons() {
    const attached = Boolean(state.analysisExchange);
    archiveButton.disabled = busy || !attached;
    nativeButton.disabled = busy || !attached || currentStatus !== 'current';
    detachButton.disabled = busy || !attached;
  }
  function showError(error) {
    notice.textContent = text('処理できません: ', 'Cannot continue: ') + error.message;
  }
  function download(name, data) {
    if (downloadURL) URL.revokeObjectURL(downloadURL);
    downloadURL = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const anchor = make('a', dialog);
    anchor.href = downloadURL; anchor.download = name; anchor.click(); anchor.remove();
  }
  async function refreshStatus() {
    const request = { display: ++display, revision: state.revision };
    currentStatus = 'checking';
    buttons();
    binding.textContent = text('CADとの関連を確認中…', 'Checking the CAD association…');
    summary.replaceChildren();
    try {
      const result = await exchangeStatus(state);
      if (disposed || !dialog.open || request.display !== display || request.revision !== state.revision) return;
      currentStatus = result.status;
      binding.textContent = result.status === 'current'
        ? text('関連付け時点のCADと一致しています。', 'CAD matches the state recorded at attachment.')
        : result.status === 'stale'
          ? text('関連付け時点のCADと一致しません。元JSONの再出力は停止しています。解析モデルを外部で確認・更新してください。交換JSONの保管は可能です。',
            'CAD differs from the state recorded at attachment. Original JSON export is disabled. Review and update the analysis model externally; the exchange JSON can still be saved.')
          : text('解析原本はまだ関連付けられていません。', 'No analysis original is attached.');
      if (result.summary) {
        const info = result.summary;
        const rows = [
          [text('形式', 'Format'), info.modelFormat],
          [text('節点', 'Nodes'), info.nodes],
          [text('要素', 'Elements'), info.elements],
          [text('ばね', 'Springs'), info.springs],
          [text('節点間拘束', 'Inter-node constraints'), info.constraints],
          [text('荷重ケース', 'Load cases'), info.loadCases],
          [text('荷重組合せ', 'Load combinations'), info.loadCombinations],
          [text('単位（原文）', 'Units (original)'), JSON.stringify(info.units)],
        ];
        for (const [label, value] of rows) {
          make('dt', summary).textContent = label;
          make('dd', summary).textContent = String(value);
        }
      }
      buttons();
    } catch (error) {
      if (disposed || !dialog.open || request.display !== display || request.revision !== state.revision) return;
      currentStatus = 'invalid';
      binding.textContent = text('解析原本の関連を確認できません。', 'The analysis association could not be checked.');
      showError(error); buttons();
    }
  }
  function applyLanguage() {
    openButton.textContent = text('解析原本の往復連携…', 'Analysis original exchange…');
    heading.textContent = text('解析原本の往復連携', 'Analysis original exchange');
    intro.textContent = text(
      '解析原本JSONを読込時点のCADに関連付け、CADファイルと一緒に保存します。座標・単位・ばね・拘束・荷重ケースを元のまま保持します。CADへの変換や、CADとの意味的一致の確認は行いません。CADの編集は解析原本へ自動反映されません。',
      'Attach an original analysis JSON to the current CAD state and retain it in the CAD file. Coordinates, units, springs, constraints and load cases are preserved. This does not convert the original into CAD or verify semantic agreement. CAD edits do not automatically update the analysis original.');
    validationHint.textContent = text(
      '対応形式: Element Modeler analysis v2、FEM-Struct-PyGo schema 1、交換JSON。読込時は構造と参照先を検査します。解析可能性や物理的な妥当性はソルバーで確認してください。交換JSONは保管用で、ソルバーへは「元の解析JSONを保存」を使います。',
      'Supported: Element Modeler analysis v2, FEM-Struct-PyGo schema 1, and exchange JSON. Import checks structure and references. Confirm solver support and physical validity in the solver. Exchange JSON is for storage; use “Save original analysis JSON” for the solver.');
    fileText.textContent = text('解析原本 / 交換JSONを読み込む', 'Import analysis original / exchange JSON');
    archiveButton.textContent = text('交換JSONを保存', 'Save exchange JSON');
    nativeButton.textContent = text('元の解析JSONを保存', 'Save original analysis JSON');
    detachButton.textContent = text('関連付けを解除', 'Detach original');
    closeButton.textContent = text('閉じる', 'Close');
    if (dialog.open) void refreshStatus();
  }
  openButton.addEventListener('click', () => {
    if (disposed) return;
    operation++; lastRevision = state.revision; notice.textContent = ''; busy = false;
    dialog.showModal();
    applyLanguage();
  });
  closeButton.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { operation++; display++; busy = false; });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    fileInput.value = '';
    operation++;
    const request = capture();
    busy = true; notice.textContent = ''; buttons();
    try {
      const data = JSON.parse(await file.text());
      if (!current(request)) return;
      await importAnalysisExchange(state, data, history, { isCurrent: () => current(request) });
      // A successful attachment changes the revision itself. The request token
      // still distinguishes this import from a newer read or a closed dialog.
      if (!active(request)) return;
      lastRevision = state.revision;
      onModelChange();
      notice.textContent = text('解析原本を関連保存しました。', 'The analysis original was attached.');
    } catch (error) { if (active(request)) showError(error); }
    finally {
      if (active(request)) { busy = false; void refreshStatus(); }
    }
  });
  archiveButton.addEventListener('click', () => {
    try { download('analysis-exchange.json', exportExchange(state)); }
    catch (error) { showError(error); }
  });
  nativeButton.addEventListener('click', async () => {
    operation++;
    const request = capture();
    busy = true; notice.textContent = ''; buttons();
    try {
      const model = await exportNativeAnalysisModel(state, { isCurrent: () => current(request) });
      if (current(request)) download('analysis-original.json', model);
    } catch (error) { if (active(request)) showError(error); }
    finally {
      if (active(request)) { busy = false; void refreshStatus(); }
    }
  });
  detachButton.addEventListener('click', () => {
    operation++;
    try {
      detachAnalysisExchange(state, history);
      lastRevision = state.revision;
      onModelChange();
      notice.textContent = text('関連付けを解除しました。「元に戻す」で復元できます。', 'Detached. Use Undo to restore the association.');
      void refreshStatus();
    } catch (error) { showError(error); }
  });
  applyLanguage(); buttons();
  return {
    applyLanguage,
    modelChanged() {
      if (lastRevision === state.revision) return;
      lastRevision = state.revision; operation++; busy = false;
      notice.textContent = '';
      if (dialog.open) void refreshStatus();
    },
    dispose() {
      disposed = true; operation++; display++;
      if (downloadURL) URL.revokeObjectURL(downloadURL);
      dialog.remove(); openButton.remove();
    },
  };
}
