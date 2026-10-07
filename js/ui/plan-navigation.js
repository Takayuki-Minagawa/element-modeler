import { t } from '../i18n.js';
import { fitPlanToPoints } from '../plan-camera.js';

// Use the same visibility rules as Canvas2D, including faded reference levels.
// Fitting the view must not reveal filtered elements or change the selection.
function* visiblePlanPoints(state) {
  const memberNodes = new Set();
  for (const member of state.members) {
    memberNodes.add(member.startNodeId);
    memberNodes.add(member.endNodeId);
    if (state.isMemberVisible(member, '2d')) {
      yield state.getNode(member.startNodeId);
      yield state.getNode(member.endNodeId);
    }
  }
  for (const node of state.nodes) if (!memberNodes.has(node.id)) yield node;
  for (const [collection, visible] of [['surfaces', 'isSurfaceVisible'], ['loads', 'isLoadVisible']]) {
    for (const item of state[collection]) {
      if (!state[visible](item, '2d')) continue;
      if (item.points?.length) yield* item.points;
      else {
        yield { x: item.x1, y: item.y1 };
        yield { x: item.x2 ?? item.x1, y: item.y2 ?? item.y1 };
      }
    }
  }
  for (const support of state.supports) if (state.isSupportVisible(support, '2d')) yield support;
  if (state.settings.showUnderlay === false) return;
  for (const entity of state.underlay?.entities || []) {
    if (entity.type === 'line') {
      yield { x: entity.x1, y: entity.y1 };
      yield { x: entity.x2, y: entity.y2 };
    } else if (entity.type === 'polyline' && Array.isArray(entity.points) && entity.points.length >= 2) {
      yield* entity.points;
    } else if (entity.type === 'circle' || entity.type === 'arc') {
      // As in the DXF reader, the full circle conservatively bounds an arc.
      yield { x: entity.cx - entity.r, y: entity.cy - entity.r };
      yield { x: entity.cx + entity.r, y: entity.cy + entity.r };
    }
  }
}

export function fitVisiblePlan(state, canvas2d) {
  if (!fitPlanToPoints(canvas2d, visiblePlanPoints(state))) {
    fitPlanToPoints(canvas2d, [{ x: 0, y: 0 }]);
  }
}

export function initPlanNavigation({ state, canvas2d, toolManager, onUpdate }) {
  const host = document.getElementById('plan-navigation');
  const pan = document.getElementById('btn-plan-pan');
  const fit = document.getElementById('btn-plan-fit');
  const hint = document.getElementById('plan-navigation-hint');
  pan.addEventListener('click', () => toolManager.setPanMode(!toolManager.panMode));
  fit.addEventListener('click', () => {
    toolManager.cancelPan({ releaseSpace: true });
    fitVisiblePlan(state, canvas2d);
    onUpdate();
  });
  function refresh() {
    pan.setAttribute('aria-pressed', String(toolManager.panMode));
    pan.textContent = t('planPan');
    fit.textContent = t('planFit');
    fit.title = t('planFitHint');
    hint.textContent = t(toolManager.panMode ? 'planPanActiveHint' : 'planPanHint');
    host.setAttribute('aria-label', t('planNavigation'));
  }
  refresh();
  return { refresh, setVisible(visible) { host.hidden = !visible; } };
}
