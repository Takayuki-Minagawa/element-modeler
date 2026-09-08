import { surfacePlacementMode } from '../domain/placement.js';
import { POLYLINE_CLOSE_TOLERANCE_PX } from '../constants.js';

import { t } from '../i18n.js';
import { isSlopedSurfaceType, isWallSurfaceType } from '../domain/model.js';

// ToolManager delegates to these cohesive behaviors; this is the existing host.
export const surfaceTool = {
  _getEffectiveSurfaceMode() {
    return surfacePlacementMode(this.state.surfaceDraftType, this.state.surfaceDraftMode);
  },

  _getAutoTopLevelId() {
    return this.state.getNextLevelId(this.state.activeLevelId);
  },

  _resolveSurfaceTopLevelId(type) {
    if (isWallSurfaceType(type)) return this._getAutoTopLevelId();
    if (isSlopedSurfaceType(type)) return this.state.activeLevelId || 'L0';
    return this.state.surfaceDraftTopLevelId || this.state.activeLevelId || 'L0';
  },

  _getWallHeightOptions(topLevelId) {
    const type = this.state.surfaceDraftType;
    if (!isWallSurfaceType(type)) return {};
    return this.state.getSurfaceHeightOffsets({
      heightMode: this.state.surfaceDraftHeightMode,
      levelId: this.state.activeLevelId || 'L0',
      topLevelId,
      bottomOffset: this.state.surfaceDraftBottomOffset,
      topOffset: this.state.surfaceDraftTopOffset,
    });
  },

  _getRoofOptions() {
    if (!isSlopedSurfaceType(this.state.surfaceDraftType)) return {};
    const options = {
      roofSlope: this.state.surfaceDraftRoofSlope,
      roofDirection: this.state.surfaceDraftRoofDirection,
      roofBaseOffset: this.state.surfaceDraftRoofBaseOffset,
      includeWind: true,
    };
    if (this.state.surfaceDraftType === 'roof') {
      options.roofGroupId = this.state.surfaceDraftRoofGroupId || 'RG1';
    }
    return options;
  },

  _surfaceDown(e) {
    return this._surfacePoint(this._getSnappedPos(e));
  },

  _surfacePoint(snapped, { exact = false } = {}) {
    const mode = this._getEffectiveSurfaceMode();
    const type = this.state.surfaceDraftType;

    if (mode === 'polyline') {
      this._surfaceStart = null;
      this._surfacePolylineDown(snapped, { exact });
      return;
    }

    this._surfacePolyline = [];

    if (!this._surfaceStart) {
      this._surfaceStart = { x: snapped.x, y: snapped.y };
      return;
    }

    const start = this._surfaceStart;
    const end = snapped;

    // Wall line: check distance; Rect: check width/height
    if (mode === 'line') {
      if (Math.hypot(end.x - start.x, end.y - start.y) < 1) return;
    } else {
      if (Math.abs(end.x - start.x) < 1 || Math.abs(end.y - start.y) < 1) return;
    }

    const topLevelId = this._resolveSurfaceTopLevelId(type);
    if (!topLevelId) {
      this._cancelDraft('noLevelAbove');
      return;
    }

    let surface;
    const heightOptions = this._getWallHeightOptions(topLevelId);
    const roofOptions = this._getRoofOptions();
    if (mode === 'line') {
      surface = this.state.addSurfaceLine(start.x, start.y, end.x, end.y, {
        type: type || 'wall',
        levelId: this.state.activeLevelId || 'L0',
        topLevelId,
        sectionName: this.state.getDraftSectionName('surface', type || 'wall'),
        ...heightOptions,
        ...roofOptions,
      });
    } else {
      surface = this.state.addSurfaceRect(start.x, start.y, end.x, end.y, {
        type: type || 'floor',
        levelId: this.state.activeLevelId || 'L0',
        topLevelId,
        loadDirection: this.state.surfaceDraftLoadDir || 'twoWay',
        sectionName: this.state.getDraftSectionName('surface', type || 'floor'),
        ...heightOptions,
        ...roofOptions,
      });
    }
    this.state.selectDrawn('surface', surface.id);

    this._surfaceStart = null;
    this.canvas2d.preview = null;
    this.onUpdate();
  },

  _surfaceMove(e) {
    const mode = this._getEffectiveSurfaceMode();

    if (mode === 'polyline') {
      this._surfacePolylineMove(e);
      return;
    }

    if (!this._surfaceStart) return;

    const snapped = this._getSnappedPos(e);
    this.canvas2d.preview = {
      startX: this._surfaceStart.x,
      startY: this._surfaceStart.y,
      endX: snapped.x,
      endY: snapped.y,
      mode: mode === 'line' ? 'line' : 'rect',
      label: `${t(this.state.surfaceDraftType || 'surface')} ${t(mode === 'line' ? 'lineLoad' : 'rectMode')}`,
    };
    this.onUpdate();
  },

  _surfacePolylineDown(snapped, { exact = false } = {}) {
    if (this._surfacePolyline.length === 0) {
      this._surfacePolyline.push({ x: snapped.x, y: snapped.y });
      this.state.clearSelection();
      this.onUpdate();
      return;
    }

    const first = this._surfacePolyline[0];
    const closeTol = POLYLINE_CLOSE_TOLERANCE_PX / this.canvas2d.camera.scale;
    if (!exact && this._surfacePolyline.length >= 3 &&
        Math.hypot(snapped.x - first.x, snapped.y - first.y) <= closeTol) {
      this._finishSurfacePolyline();
      return;
    }

    const last = this._surfacePolyline[this._surfacePolyline.length - 1];
    if (Math.hypot(snapped.x - last.x, snapped.y - last.y) < 1) return;
    this._surfacePolyline.push({ x: snapped.x, y: snapped.y });
    this.onUpdate();
  },

  _surfacePolylineMove(e) {
    if (this._surfacePolyline.length === 0) return;
    const snapped = this._getSnappedPos(e);
    const points = [...this._surfacePolyline, { x: snapped.x, y: snapped.y }];
    this.canvas2d.preview = {
      mode: 'polyline',
      points,
      closeHint: this._surfacePolyline.length >= 3,
      label: `${t(this.state.surfaceDraftType || 'surface')} ${points.length}pt`,
    };
    this.onUpdate();
  },

  _finishSurfacePolyline() {
    if (this._surfacePolyline.length < 3) return;
    const type = this.state.surfaceDraftType;
    const isWallType = isWallSurfaceType(type);

    const topLevelId = this._resolveSurfaceTopLevelId(type);
    if (!topLevelId) {
      this._cancelDraft('noLevelAbove');
      return;
    }

    const existing = type === 'exteriorWall' ? this.state.surfaces.find(
      item => item.type === type && item.levelId === this.state.activeLevelId
    ) : null;
    if (existing && !confirm(t('exteriorWallConfirmReplace'))) return;

    const surface = this.state.addSurfacePolygon(this._surfacePolyline, {
      type: type || 'wall',
      levelId: this.state.activeLevelId || 'L0',
      topLevelId,
      loadDirection: isWallType ? 'twoWay' : (this.state.surfaceDraftLoadDir || 'twoWay'),
      sectionName: this.state.getDraftSectionName('surface', type || 'wall'),
      ...this._getWallHeightOptions(topLevelId),
      ...this._getRoofOptions(),
    });
    if (surface) {
      if (existing) this.state.removeSurface(existing.id);
      this.state.selectDrawn('surface', surface.id);
    }
    this._surfacePolyline = [];
    this._surfaceStart = null;
    this.canvas2d.preview = null;
    this.onUpdate();
  }
};
