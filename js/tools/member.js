

import { t } from '../i18n.js';

// ToolManager delegates to these cohesive behaviors; this is the existing host.
export const memberTool = {
  _memberDown(e) {
    return this._memberPoint(this._getSnappedPos(e));
  },

  _memberPoint(snapped) {

    if (this.state.memberDraftType === 'column') {
      this._placeColumn(snapped);
      return;
    }

    if (!this._memberStart) {
      this._memberStart = { x: snapped.x, y: snapped.y };
      return;
    }

    const start = this._memberStart;
    const end = snapped;

    if (Math.hypot(end.x - start.x, end.y - start.y) < 1) return;

    // 水平ブレースは斜め配置のみ（X軸・Y軸に平行な配置は不可）
    if (this.state.memberDraftType === 'hbrace') {
      const dx = Math.abs(end.x - start.x);
      const dy = Math.abs(end.y - start.y);
      if (dx < 1 || dy < 1) {
        alert(t('hbraceNeedsDiagonal'));
        return;
      }
    }

    // 垂直ブレースは上レイヤーが必要
    let topLevelId = null;
    if (this.state.memberDraftType === 'vbrace') {
      topLevelId = this._getAutoTopLevelId();
      if (!topLevelId) {
        this._cancelDraft('noLevelAbove');
        return;
      }
    }

    let startNode = this.state.findNodeAt(start.x, start.y, 1);
    if (!startNode) startNode = this.state.addNode(start.x, start.y);

    let endNode = this.state.findNodeAt(end.x, end.y, 1);
    if (!endNode) endNode = this.state.addNode(end.x, end.y);

    const memberType = this.state.memberDraftType || 'beam';
    const member = this.state.addMember(startNode.id, endNode.id, {
      type: memberType,
      levelId: this.state.activeLevelId || 'L0',
      topLevelId,
      sectionName: this.state.getDraftSectionName('member', memberType),
    });

    this.state.selectDrawn('member', member.id);
    this._memberStart = null;
    this.canvas2d.preview = null;
    this.onUpdate();
  },

  _placeColumn(snapped) {
    const sortedLevels = [...this.state.levels].sort((a, b) => a.z - b.z);
    const activeIdx = sortedLevels.findIndex(l => l.id === this.state.activeLevelId);
    if (activeIdx < 0 || activeIdx >= sortedLevels.length - 1) {
      alert(t('noLevelAbove'));
      return;
    }
    const topLevel = sortedLevels[activeIdx + 1];

    let node = this.state.findNodeAt(snapped.x, snapped.y, 1);
    if (!node) node = this.state.addNode(snapped.x, snapped.y);

    const member = this.state.addMember(node.id, node.id, {
      type: 'column',
      levelId: this.state.activeLevelId,
      topLevelId: topLevel.id,
      sectionName: this.state.getDraftSectionName('member', 'column'),
    });
    this.state.selectDrawn('member', member.id);
    this.onUpdate();
  },

  _memberMove(e) {
    if (!this._memberStart) return;
    if (this.state.memberDraftType === 'column') return;

    const snapped = this._getSnappedPos(e);
    this.canvas2d.preview = {
      startX: this._memberStart.x,
      startY: this._memberStart.y,
      endX: snapped.x,
      endY: snapped.y,
      mode: 'line',
      label: this._memberPreviewLabel(this._memberStart, snapped),
    };
    this.onUpdate();
  },

  _memberPreviewLabel(start, end) {
    const type = this.state.memberDraftType || 'beam';
    const sectionName = this.state.getDraftSectionName('member', type) || '-';
    const length = Math.round(Math.hypot(end.x - start.x, end.y - start.y));
    const level = this.state.levels.find(l => l.id === this.state.activeLevelId);
    const levelLabel = level ? level.name : (this.state.activeLevelId || '-');
    if (type === 'vbrace') {
      const top = this.state.levels.find(l => l.id === this._getAutoTopLevelId());
      return `${t(type)} ${levelLabel}->${top?.name || '-'} ${sectionName} ${length}mm`;
    }
    return `${t(type)} ${levelLabel} ${sectionName} ${length}mm`;
  }
};
