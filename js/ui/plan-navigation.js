import { t } from '../i18n.js';
import { fitPlanToPoints } from './focus-issue.js';

// Use the same visibility rules as Canvas2D, including faded reference levels.
// Fitting the view must not reveal filtered elements or change the selection.
function visiblePlanPoints(state) {
  const points = [];
  const memberNodes = new Set();
  for (const member of state.members) {
    memberNodes.add(member.startNodeId);
    memberNodes.add(member.endNodeId);
    if (state.isMemberVisible(member, '2d')) {
      points.push(state.getNode(member.startNodeId), state.getNode(member.endNodeId));
    }
  }
  points.push(...state.nodes.filter(node => !memberNodes.has(node.id)));
  for (const [collection, visible] of [['surfaces', 'isSurfaceVisible'], ['loads', 'isLoadVisible']]) {
    for (const item of state[collection]) {
      if (!state[visible](item, '2d')) continue;
      if (item.points?.length) points.push(...item.points);
      else points.push({ x: item.x1, y: item.y1 }, { x: item.x2 ?? item.x1, y: item.y2 ?? item.y1 });
    }
  }
  points.push(...state.supports.filter(item => state.isSupportVisible(item, '2d')));
  return points.length ? points : [{ x: 0, y: 0 }];
}

export function initPlanNavigation({ state, canvas2d, toolManager, onUpdate }) {
  const host = document.getElementById('plan-navigation');
  const pan = document.getElementById('btn-plan-pan');
  const fit = document.getElementById('btn-plan-fit');
  const hint = document.getElementById('plan-navigation-hint');
  pan.addEventListener('click', () => toolManager.setPanMode(!toolManager.panMode));
  fit.addEventListener('click', () => {
    toolManager.cancelPan({ releaseSpace: true });
    fitPlanToPoints(canvas2d, visiblePlanPoints(state));
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
