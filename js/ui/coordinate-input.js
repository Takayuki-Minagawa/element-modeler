import { getLang, t } from '../i18n.js';

export function initCoordinateInput({ state, toolManager, activatePlanInput }) {
  const form = document.getElementById('coordinate-form');
  const fields = document.getElementById('coordinate-fields');
  const status = document.getElementById('coordinate-state');
  const result = document.getElementById('coordinate-result');
  const finish = document.getElementById('btn-coordinate-finish');
  const cancel = document.getElementById('btn-coordinate-cancel');
  let lastKey = '';
  function refresh() {
    const draft = toolManager.getPlacementState();
    const key = JSON.stringify([getLang(), state.currentTool, state.activeLevelId,
      state.revision, draft]);
    if (key === lastKey) return;
    lastKey = key;
    fields.disabled = !draft.canInput;
    finish.hidden = !draft.isPolyline;
    finish.disabled = !draft.canFinish;
    cancel.disabled = !draft.canCancel;
    const last = draft.points.at(-1);
    status.textContent = draft.canInput
      ? t('coordinatePending', { count: draft.points.length }) +
        (last ? ' / X ' + last.x + ' / Y ' + last.y + ' mm' : '')
      : t('coordinateChoose');
    if (draft.measurement) {
      const values = Object.fromEntries(Object.entries(draft.measurement).map(
        ([key, value]) => [key, Number(value.toFixed(3))]));
      status.textContent += ' / ' + t('coordinateMeasurement', values);
    }
    result.textContent = '';
  }
  function perform(action, message) {
    activatePlanInput();
    const before = JSON.stringify([state.revision, toolManager.getPlacementState().points]);
    action();
    const changed = before !== JSON.stringify([state.revision, toolManager.getPlacementState().points]);
    refresh();
    result.textContent = changed ? message : t('coordinateNoChange');
  }
  for (const input of form.querySelectorAll('input')) {
    input.addEventListener('invalid', () => {
      input.setAttribute('aria-invalid', 'true');
      result.textContent = t('coordinateInvalid');
    });
    input.addEventListener('input', () => {
      input.removeAttribute('aria-invalid');
      result.textContent = '';
    });
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!form.reportValidity() || !toolManager.getPlacementState().canInput) return;
    const x = document.getElementById('coordinate-x').valueAsNumber;
    const y = document.getElementById('coordinate-y').valueAsNumber;
    perform(() => toolManager.inputPoint(x, y), t('coordinateApplied', { x, y }));
  });
  finish.addEventListener('click', () => perform(
    () => toolManager.finishPlacement(), t('coordinateCompleted')));
  cancel.addEventListener('click', () => {
    toolManager.cancelPlacement();
    activatePlanInput();
    refresh();
    result.textContent = t('coordinateCancelled');
  });
  refresh();
  return { refresh };
}
