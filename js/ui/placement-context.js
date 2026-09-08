import { surfacePlacementMode } from '../domain/placement.js';

export function placementContext(state) {
  const tool = state.currentTool;
  const type = tool === 'member' ? state.memberDraftType : tool === 'surface' ? state.surfaceDraftType : '';
  let guide = { select: 'guideSelect', support: 'guideSupport', measure: 'guideMeasure', splitPoint: 'splitAtPointHint' }[tool];
  if (tool === 'member') guide = type === 'column' ? 'guideColumn' : 'guideMember';
  if (tool === 'surface') guide = { line: 'guideWall', polyline: 'guidePolyline', rect: 'guideSurface' }[surfacePlacementMode(type, state.surfaceDraftMode)];
  if (tool === 'load') guide = state.loadDraftType === 'pointLoad' ? 'guidePointLoad' : 'guideLoad';
  const settings = state.settings;
  const visible = { member: settings.showMembers, surface: settings.showSurfaces, load: settings.showLoads, support: settings.showSupports }[tool];
  const memberFiltered = tool === 'member' && (
    settings.memberTypeFilter !== 'all' && settings.memberTypeFilter && settings.memberTypeFilter !== type ||
    settings.sectionFilter !== 'all' && settings.sectionFilter && settings.sectionFilter !== state.getDraftSectionName('member', type)
  );
  return { type, guide: guide || 'guideSelect', hiddenByDisplay: visible === false || Boolean(memberFiltered) };
}
