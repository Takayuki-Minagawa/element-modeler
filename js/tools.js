import { executeModelCommand } from './commands/model-command.js';
import { finishDrag } from './tools/drag-edit.js';
import { selectionTool } from './tools/selection.js';
import { memberTool } from './tools/member.js';
import { surfaceTool } from './tools/surface.js';
import { loadTool } from './tools/load.js';
import { measureTool } from './tools/measure.js';
import { supportTool } from './tools/support.js';
// tools.js - Select / Member / Surface tools

import { MEMBER_SPLIT_TOLERANCE_MM, PICK_TOLERANCE_PX, WIDE_PICK_TOLERANCE_PX } from './constants.js';
import { segmentParameter } from './geometry-utils.js';
import { applySnap } from './grid.js';
import { t } from './i18n.js';

function projectSplitPointTarget(member) {
  return Boolean(
    member &&
    member.type === 'beam' &&
    member.geometryMode !== 'explicit3d' &&
    !member.roofRole
  );
}

// Projects an already-snapped cursor position onto the selected beam and
// rejects cuts within the endpoint tolerance. Keeping this calculation here
// makes the preview and the model operation agree on the point shown to users.
export function projectSplitPoint(state, member, point, tolerance = MEMBER_SPLIT_TOLERANCE_MM) {
  if (!member || member.type !== 'beam' || member.geometryMode === 'explicit3d' || member.roofRole) {
    return null;
  }
  const start = state.getNode(member.startNodeId);
  const end = state.getNode(member.endNodeId);
  if (!start || !end) return null;
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (length <= 0) return null;
  const parameter = segmentParameter(
    point.x,
    point.y,
    start.x,
    start.y,
    end.x,
    end.y
  );
  const endpointParameter = Math.max(0, Number(tolerance) || 0) / length;
  if (parameter <= endpointParameter || parameter >= 1 - endpointParameter) return null;
  return {
    x: start.x + parameter * (end.x - start.x),
    y: start.y + parameter * (end.y - start.y),
  };
}

export class ToolManager {
  constructor(canvas2d, state, history, onUpdate, callbacks = {}) {
    this.canvas2d = canvas2d;
    this.state = state;
    this.history = history;
    this.onUpdate = onUpdate;
    this.callbacks = callbacks;

    // Internal state
    this._isPanning = false;
    this._panStart = null;
    this._spaceDown = false;

    // Draw tool states
    this._memberStart = null;
    this._surfaceStart = null;
    this._surfacePolyline = [];
    this._loadStart = null;
    this._measureStart = null;
    this._splitPointMemberId = null;
    this._splitPointPreviousTool = null;

    // Select tool drag state
    this._dragTarget = null; // { type: 'node'|'member'|'group', ... }
    this._isDragging = false;
    this._dragStartPos = null;
    this._marqueeStart = null;
    this._marqueeAdditive = false;

    this._setupEvents();
  }

  // Starts the temporary beam split interaction. The selected member is kept
  // as the target until the user confirms a point, presses Escape, changes
  // tools, or clears/replaces the selection.
  startSplitPoint(memberId) {
    const member = this.state.getMember(memberId);
    if (!projectSplitPointTarget(member)) return false;
    if (this._splitPointMemberId === memberId && this.state.currentTool === 'splitPoint') return true;

    this._memberStart = null;
    this._surfaceStart = null;
    this._surfacePolyline = [];
    this._loadStart = null;
    this._measureStart = null;
    this.canvas2d.measure = null;
    this.canvas2d.preview = null;
    this._splitPointPreviousTool = this.state.currentTool === 'splitPoint'
      ? (this._splitPointPreviousTool || 'select')
      : this.state.currentTool;
    this._splitPointMemberId = memberId;
    this.state.select('member', memberId);
    this.state.currentTool = 'splitPoint';
    this.callbacks.onTemporaryToolChange?.('splitPoint');
    this.onUpdate();
    return true;
  }

  isSplitPointActive() {
    return Boolean(this._splitPointMemberId && this.state.currentTool === 'splitPoint');
  }

  // Called by app-level selection paths (for example, 3D picking) before a
  // render so a stale temporary tool never operates on a deselected member.
  syncSplitPointSelection() {
    if (!this._splitPointMemberId) return false;
    if (this.state.currentTool === 'splitPoint' &&
        this.state.isMemberSelected(this._splitPointMemberId) &&
        this.state.getMember(this._splitPointMemberId)) {
      return true;
    }
    this.cancelSplitPoint({ restoreTool: this.state.currentTool === 'splitPoint', update: false });
    return false;
  }

  cancelSplitPoint({ restoreTool = true, update = true } = {}) {
    if (!this._splitPointMemberId && this.state.currentTool !== 'splitPoint') return false;
    const previousTool = this._splitPointPreviousTool || 'select';
    this._splitPointMemberId = null;
    this._splitPointPreviousTool = null;
    this.canvas2d.preview = null;
    if (restoreTool && this.state.currentTool === 'splitPoint') {
      this.state.currentTool = previousTool;
    }
    this.callbacks.onTemporaryToolChange?.(this.state.currentTool);
    if (update) this.onUpdate();
    return true;
  }

  _runModelCommand(mutate) {
    if (this._modelCommandActive) return mutate();
    this._modelCommandActive = true;
    try {
      return executeModelCommand(this.history, this.state, mutate).result;
    } finally {
      this._modelCommandActive = false;
    }
  }

  cancelDrag() {
    if (!this._dragTarget && !this._marqueeStart) return false;
    finishDrag(this, false);
    this._dragTarget = null;
    this._dragStartPos = null;
    this._isDragging = false;
    this._marqueeStart = null;
    this.canvas2d.marquee = null;
    this.onUpdate();
    return true;
  }

  _setupEvents() {
    const el = this.canvas2d.canvas;

    el.addEventListener('mousedown', e => this._onMouseDown(e));
    el.addEventListener('mousemove', e => this._onMouseMove(e));
    el.addEventListener('mouseup', e => this._onMouseUp(e));
    el.addEventListener('wheel', e => this._onWheel(e), { passive: false });
    el.addEventListener('contextmenu', e => e.preventDefault());

    window.addEventListener('keydown', e => this._onKeyDown(e));
    window.addEventListener('keyup', e => this._onKeyUp(e));
    window.addEventListener('blur', () => this.cancelDrag());
    window.addEventListener('mouseup', e => {
      if (this._dragTarget || this._marqueeStart) this._selectUp(e);
    });
  }

  _getScreenPos(e) {
    const rect = this.canvas2d.canvas.getBoundingClientRect();
    return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
  }

  _getWorldPos(e) {
    const { sx, sy } = this._getScreenPos(e);
    return this.canvas2d.screenToWorld(sx, sy);
  }

  _getSnappedPos(e) {
    const world = this._getWorldPos(e);
    if (e.shiftKey && this._memberStart) {
      return this._constrainAngle(this._memberStart, world);
    }
    return applySnap(world.x, world.y, this.state, this.canvas2d.camera);
  }

  // Pick tolerance in world units (mm), derived from a screen-px tolerance.
  _pickTolerance() {
    const basePx = this.state.settings.widePick ? WIDE_PICK_TOLERANCE_PX : PICK_TOLERANCE_PX;
    return basePx / this.canvas2d.camera.scale;
  }

  // Aborts the current draw interaction: alerts the user, drops all pending
  // draft points, and clears the canvas preview (same reset as Escape).
  _cancelDraft(messageKey) {
    alert(t(messageKey));
    this._memberStart = null;
    this._surfaceStart = null;
    this._surfacePolyline = [];
    this._loadStart = null;
    this.canvas2d.preview = null;
    this.onUpdate();
  }

  _constrainAngle(origin, pos) {
    const dx = pos.x - origin.x;
    const dy = pos.y - origin.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) return { x: origin.x, y: origin.y };

    const angle = Math.atan2(dy, dx);
    const snapAngles = [0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4, Math.PI,
      -Math.PI / 4, -Math.PI / 2, -3 * Math.PI / 4];
    let closest = snapAngles[0];
    let minDiff = Math.abs(angle - snapAngles[0]);
    for (const a of snapAngles) {
      const diff = Math.abs(angle - a);
      if (diff < minDiff) {
        minDiff = diff;
        closest = a;
      }
    }
    return {
      x: origin.x + len * Math.cos(closest),
      y: origin.y + len * Math.sin(closest),
    };
  }

  // --- Mouse Events ---

  _onMouseDown(e) {
    const { sx, sy } = this._getScreenPos(e);

    // Pan: middle button, right button, or space+left
    if (e.button === 1 || e.button === 2 || (e.button === 0 && this._spaceDown)) {
      this._isPanning = true;
      this._panStart = { x: sx, y: sy };
      e.preventDefault();
      return;
    }

    if (e.button !== 0) return;

    const tool = this.state.currentTool;

    if (tool === 'splitPoint') {
      this._splitPointDown(e);
    } else if (tool === 'select') {
      this._selectDown(e);
    } else if (tool === 'member') {
      this._memberDown(e);
    } else if (tool === 'surface') {
      this._surfaceDown(e);
    } else if (tool === 'load') {
      this._loadDown(e);
    } else if (tool === 'support') {
      this._supportDown(e);
    } else if (tool === 'measure') {
      this._measureDown(e);
    }
  }

  _onMouseMove(e) {
    const { sx, sy } = this._getScreenPos(e);

    // Pan
    if (this._isPanning && this._panStart) {
      this.canvas2d.pan(sx - this._panStart.x, sy - this._panStart.y);
      this._panStart = { x: sx, y: sy };
      this.onUpdate();
      return;
    }

    const tool = this.state.currentTool;

    if (tool === 'splitPoint') {
      this._splitPointMove(e);
    } else if (tool === 'select') {
      this._selectMove(e);
    } else if (tool === 'member') {
      this._memberMove(e);
    } else if (tool === 'surface') {
      this._surfaceMove(e);
    } else if (tool === 'load') {
      this._loadMove(e);
    } else if (tool === 'measure') {
      this._measureMove(e);
    }

    const world = this._getWorldPos(e);
    this._updateCoords(world.x, world.y);
  }

  _onMouseUp(e) {
    if (this._isPanning) {
      this._isPanning = false;
      this._panStart = null;
      return;
    }

    if (this.state.currentTool === 'select') {
      this._selectUp(e);
    }
  }

  _onWheel(e) {
    e.preventDefault();
    const { sx, sy } = this._getScreenPos(e);
    this.canvas2d.zoom(e.deltaY, sx, sy);
    this.onUpdate();
  }

  _onKeyDown(e) {
    const targetTag = e.target?.tagName;
    const isEditableTarget = targetTag === 'INPUT' || targetTag === 'SELECT' ||
      targetTag === 'TEXTAREA' || e.target?.isContentEditable;

    if (e.code === 'Space' && !isEditableTarget) {
      this._spaceDown = true;
      e.preventDefault();
    }

    // Esc: cancel or deselect
    if (e.key === 'Escape') {
      if (this.cancelDrag()) return;
      if (this.state.currentTool === 'splitPoint' || this._splitPointMemberId) {
        e.preventDefault();
        this.cancelSplitPoint();
        return;
      } else if ((this.state.currentTool === 'member' && this._memberStart) ||
          (this.state.currentTool === 'surface' && (this._surfaceStart || this._surfacePolyline.length)) ||
          (this.state.currentTool === 'load' && this._loadStart) ||
          (this.state.currentTool === 'measure' && (this._measureStart || this.canvas2d.measure))) {
        this._memberStart = null;
        this._surfaceStart = null;
        this._surfacePolyline = [];
        this._loadStart = null;
        this._measureStart = null;
        this.canvas2d.preview = null;
        this.canvas2d.measure = null;
        this.onUpdate();
      } else {
        this.state.clearSelection();
        this.onUpdate();
      }
    }

    // Delete (skip when focused on input/select)
    if ((e.key === 'Delete' || e.key === 'Backspace') && !isEditableTarget) {
      this.deleteSelection();
    }

    // Undo/Redo
    if ((e.ctrlKey || e.metaKey) && !isEditableTarget) {
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        this.cancelDrag();
        if (this.history.undo()) this.onUpdate();
      } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
        e.preventDefault();
        this.cancelDrag();
        if (this.history.redo()) this.onUpdate();
      }
    }

    // Close polyline surface
    if (!isEditableTarget && this.state.currentTool === 'surface' &&
        this.state.surfaceDraftMode === 'polyline' &&
        (e.key === 'Enter' || e.key === 'Return')) {
      this._finishSurfacePolyline();
    }
  }

  // Shared by toolbar commands and tool changes; preserves model selection.
  cancelPlacement() {
    this.cancelDrag();
    this.cancelSplitPoint({ update: false });
    this._memberStart = null;
    this._surfaceStart = null;
    this._surfacePolyline = [];
    this._loadStart = null;
    this._measureStart = null;
    this.canvas2d.preview = null;
    this.canvas2d.measure = null;
  }

  deleteSelection() {
    this.cancelDrag();
    if (this.state.selectedSupportId) {
      const support = this.state.getSupport(this.state.selectedSupportId);
      if (!this.state.isSupportSelectable(support)) return;
      this.history.save();
      this.state.removeSupport(this.state.selectedSupportId);
      this.onUpdate();
    } else if (this.state.selectedLoadId) {
      const load = this.state.getLoad(this.state.selectedLoadId);
      if (!this.state.isLoadSelectable(load)) return;
      this.history.save();
      this.state.removeLoad(this.state.selectedLoadId);
      this.onUpdate();
    } else if (this.state.selectedSurfaceId) {
      const surface = this.state.getSurface(this.state.selectedSurfaceId);
      if (!this.state.isSurfaceSelectable(surface)) return;
      this.history.save();
      this.state.removeSurface(this.state.selectedSurfaceId);
      this.onUpdate();
    } else if (this.state.selectedMemberIds.length > 0) {
      const removable = this.state.selectedMemberIds
        .map(id => this.state.getMember(id))
        .filter(member => member && this.state.isMemberSelectable(member));
      if (!removable.length) return;
      this.history.save();
      for (const member of removable) {
        this.state.removeMember(member.id);
      }
      this.onUpdate();
    }
  }

  _onKeyUp(e) {
    if (e.code === 'Space') {
      this._spaceDown = false;
    }
  }

  // --- Select Tool ---

  _selectDown(...args) {
    return selectionTool._selectDown.apply(this, args);
  }

  // Snapshot of every node in the multi-selection for group dragging.
  _buildGroupDragTarget(...args) {
    return selectionTool._buildGroupDragTarget.apply(this, args);
  }

  _findSelectableMemberNodeAt(...args) {
    return selectionTool._findSelectableMemberNodeAt.apply(this, args);
  }

  _findSelectableSupportAt(...args) {
    return selectionTool._findSelectableSupportAt.apply(this, args);
  }

  _findSelectableLoadAt(...args) {
    return selectionTool._findSelectableLoadAt.apply(this, args);
  }

  _findSelectableSurfaceAt(...args) {
    return selectionTool._findSelectableSurfaceAt.apply(this, args);
  }

  _findSelectableMemberAt(...args) {
    return selectionTool._findSelectableMemberAt.apply(this, args);
  }

  _selectMove(...args) {
    return selectionTool._selectMove.apply(this, args);
  }

  _selectUp(...args) {
    return selectionTool._selectUp.apply(this, args);
  }

  _finishMarquee(...args) {
    return selectionTool._finishMarquee.apply(this, args);
  }

  // --- Split Point Tool ---

  _splitPointMember() {
    const member = this.state.getMember(this._splitPointMemberId);
    if (!member || !this.state.isMemberSelected(member.id) || !projectSplitPointTarget(member)) {
      this.cancelSplitPoint();
      return null;
    }
    return member;
  }

  _splitPointProjection(e) {
    const member = this._splitPointMember();
    if (!member) return null;
    return projectSplitPoint(this.state, member, this._getSnappedPos(e));
  }

  _splitPointMove(e) {
    const point = this._splitPointProjection(e);
    this.canvas2d.preview = point
      ? { mode: 'point', x: point.x, y: point.y, label: t('splitAtPointHint') }
      : null;
    this.onUpdate();
  }

  _splitPointDown(e) {
    const memberId = this._splitPointMemberId;
    const point = this._splitPointProjection(e);
    if (!point) {
      this.callbacks.onSplitPointFailed?.();
      return;
    }

    let result = null;
    const changed = this.history.transact(() => {
      result = this.state.splitMemberAtPoint(memberId, point);
      return Boolean(result);
    });
    if (!changed || !result) {
      this.callbacks.onSplitPointFailed?.();
      return;
    }

    this.state.selectMembers(result.createdMemberIds);
    this.cancelSplitPoint({ update: false });
    this.onUpdate();
    this.callbacks.onSplitPointComplete?.(result);
  }

  // --- Member Tool ---

  _memberDown(...args) {
    return this._runModelCommand(() => memberTool._memberDown.apply(this, args));
  }

  _placeColumn(...args) {
    return this._runModelCommand(() => memberTool._placeColumn.apply(this, args));
  }

  _memberMove(...args) {
    return memberTool._memberMove.apply(this, args);
  }

  _memberPreviewLabel(...args) {
    return memberTool._memberPreviewLabel.apply(this, args);
  }

  // --- Surface Tool ---

  _getEffectiveSurfaceMode(...args) {
    return surfaceTool._getEffectiveSurfaceMode.apply(this, args);
  }

  _getAutoTopLevelId(...args) {
    return surfaceTool._getAutoTopLevelId.apply(this, args);
  }

  // Resolves the top level for a new surface of the given type. Returns null
  // for wall types when there is no level above the active one.
  _resolveSurfaceTopLevelId(...args) {
    return surfaceTool._resolveSurfaceTopLevelId.apply(this, args);
  }

  _getWallHeightOptions(...args) {
    return surfaceTool._getWallHeightOptions.apply(this, args);
  }

  _getRoofOptions(...args) {
    return surfaceTool._getRoofOptions.apply(this, args);
  }

  _surfaceDown(...args) {
    return this._runModelCommand(() => surfaceTool._surfaceDown.apply(this, args));
  }

  _surfaceMove(...args) {
    return surfaceTool._surfaceMove.apply(this, args);
  }

  _surfacePolylineDown(...args) {
    return this._runModelCommand(() => surfaceTool._surfacePolylineDown.apply(this, args));
  }

  _surfacePolylineMove(...args) {
    return surfaceTool._surfacePolylineMove.apply(this, args);
  }

  _finishSurfacePolyline(...args) {
    return this._runModelCommand(() => surfaceTool._finishSurfacePolyline.apply(this, args));
  }

  // --- Load Tool ---

  _loadDown(...args) {
    return this._runModelCommand(() => loadTool._loadDown.apply(this, args));
  }

  _loadMove(...args) {
    return loadTool._loadMove.apply(this, args);
  }

  // --- Measure Tool ---

  _measureDown(...args) {
    return measureTool._measureDown.apply(this, args);
  }

  _measureMove(...args) {
    return measureTool._measureMove.apply(this, args);
  }

  // --- Support Tool ---

  _supportDown(...args) {
    return this._runModelCommand(() => supportTool._supportDown.apply(this, args));
  }

  // --- Status ---

  _updateCoords(x, y) {
    const el = document.getElementById('status-coords');
    if (el) el.textContent = `X: ${Math.round(x)}  Y: ${Math.round(y)}`;
  }
}
