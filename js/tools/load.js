

import { t } from '../i18n.js';

// ToolManager delegates to these cohesive behaviors; this is the existing host.
export const loadTool = {
  _loadDown(e) {
    return this._loadPoint(this._getSnappedPos(e));
  },

  _loadPoint(snapped) {
    const type = this.state.loadDraftType;

    if (type === 'pointLoad') {
        const load = this.state.addLoad('pointLoad', {
        x1: snapped.x, y1: snapped.y,
        levelId: this.state.activeLevelId || 'L0',
      });
      this.state.selectDrawn('load', load.id);
      this.canvas2d.preview = null;
      this.onUpdate();
      return;
    }

    // areaLoad / lineLoad: two-click
    if (!this._loadStart) {
      this._loadStart = { x: snapped.x, y: snapped.y };
      return;
    }

    const start = this._loadStart;
    const end = snapped;

    if (type === 'areaLoad') {
      if (Math.abs(end.x - start.x) < 1 || Math.abs(end.y - start.y) < 1) return;
    } else {
      if (Math.hypot(end.x - start.x, end.y - start.y) < 1) return;
    }

    const load = this.state.addLoad(type, {
      x1: start.x, y1: start.y, x2: end.x, y2: end.y,
      levelId: this.state.activeLevelId || 'L0',
    });
    this.state.selectDrawn('load', load.id);
    this._loadStart = null;
    this.canvas2d.preview = null;
    this.onUpdate();
  },

  _loadMove(e) {
    if (!this._loadStart) return;
    if (this.state.loadDraftType === 'pointLoad') return;

    const snapped = this._getSnappedPos(e);
    this.canvas2d.preview = {
      startX: this._loadStart.x,
      startY: this._loadStart.y,
      endX: snapped.x,
      endY: snapped.y,
      mode: this.state.loadDraftType === 'areaLoad' ? 'rect' : 'line',
      label: t(this.state.loadDraftType || 'load'),
    };
    this.onUpdate();
  }
};
