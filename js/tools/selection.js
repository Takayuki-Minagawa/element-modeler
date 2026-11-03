import { beginDrag, finishDrag, previewNode } from './drag-edit.js';

import { applySnap } from '../grid.js';
import { memberIdsInMarquee } from '../domain/marquee-selection.js';

// ToolManager delegates to these cohesive behaviors; this is the existing host.
export const selectionTool = {
  _selectDown(e) {
    const world = this._getWorldPos(e);
    const tolerance = this._pickTolerance();

    // Shift+click toggles members in/out of the multi-selection.
    if (e.shiftKey) {
      const member = this._findSelectableMemberAt(world.x, world.y, tolerance);
      if (member) {
        this.state.toggleMemberSelection(member.id);
        this._dragTarget = null;
        this.onUpdate();
        return;
      }
      // Shift+drag on empty space: additive marquee.
      this._marqueeStart = { x: world.x, y: world.y };
      this._marqueeAdditive = true;
      return;
    }

    // Click-only hits, in priority order: support (small target) > load >
    // surface. The first hit wins and becomes the exclusive selection.
    const hitTests = [
      { kind: 'support', find: () => this._findSelectableSupportAt(world.x, world.y, tolerance) },
      { kind: 'load', find: () => this._findSelectableLoadAt(world.x, world.y) },
      { kind: 'surface', find: () => this._findSelectableSurfaceAt(world.x, world.y) },
    ];
    for (const { kind, find } of hitTests) {
      const hit = find();
      if (!hit) continue;
      this.state.select(kind, hit.id);
      this._dragTarget = null;
      this.onUpdate();
      return;
    }

    // Node hit: select the member and start dragging its endpoint
    const nodeHit = this._findSelectableMemberNodeAt(world.x, world.y, tolerance);
    if (nodeHit) {
      const { member, node } = nodeHit;
      this.state.select('member', member.id);
      this._dragTarget = { type: 'node', id: node.id };
      this._isDragging = false;
      this._dragStartPos = { x: world.x, y: world.y };
      this.onUpdate();
      return;
    }

    // Member hit: select and start dragging. Clicking a member of the current
    // multi-selection drags the whole group.
    const member = this._findSelectableMemberAt(world.x, world.y, tolerance);
    if (member) {
      if (this.state.selectedMemberIds.length > 1 && this.state.isMemberSelected(member.id)) {
        this._dragTarget = this._buildGroupDragTarget();
      } else {
        this.state.select('member', member.id);
        const n1 = this.state.getNode(member.startNodeId);
        const n2 = this.state.getNode(member.endNodeId);
        this._dragTarget = {
          type: 'member',
          id: member.id,
          offsetStartX: n1.x - world.x,
          offsetStartY: n1.y - world.y,
          offsetEndX: n2.x - world.x,
          offsetEndY: n2.y - world.y,
        };
      }
      this._isDragging = false;
      this._dragStartPos = { x: world.x, y: world.y };
      this.onUpdate();
      return;
    }

    // Empty space: begin a marquee selection (selection is replaced on
    // mouseup; a plain click still clears it there).
    this._marqueeStart = { x: world.x, y: world.y };
    this._marqueeAdditive = false;
    this._dragTarget = null;
  },

  _buildGroupDragTarget() {
    const nodeStart = new Map();
    for (const id of this.state.selectedMemberIds) {
      const member = this.state.getMember(id);
      if (!member) continue;
      for (const nodeId of [member.startNodeId, member.endNodeId]) {
        if (nodeStart.has(nodeId)) continue;
        const node = this.state.getNode(nodeId);
        if (node) nodeStart.set(nodeId, { x: node.x, y: node.y });
      }
    }
    return { type: 'group', nodeStart };
  },

  _findSelectableMemberNodeAt(x, y, tolerance) {
    let best = null;
    let bestDist = tolerance;
    for (const member of this.state.members) {
      if (!this.state.isMemberSelectable(member)) continue;
      for (const nodeId of [member.startNodeId, member.endNodeId]) {
        const node = this.state.getNode(nodeId);
        if (!node) continue;
        const dist = Math.hypot(node.x - x, node.y - y);
        if (dist < bestDist) {
          bestDist = dist;
          best = { member, node };
        }
      }
    }
    return best;
  },

  _findSelectableSupportAt(x, y, tolerance) {
    if (this.state.settings.showSupports === false) return null;
    return this.state.findSupportAt(x, y, tolerance, support => this.state.isSupportSelectable(support));
  },

  _findSelectableLoadAt(x, y) {
    return this.state.findLoadAt(x, y, load => this.state.isLoadSelectable(load));
  },

  _findSelectableSurfaceAt(x, y) {
    return this.state.findSurfaceAt(x, y, surface => this.state.isSurfaceSelectable(surface));
  },

  _findSelectableMemberAt(x, y, tolerance) {
    return this.state.findMemberAt(x, y, tolerance, member => this.state.isMemberSelectable(member));
  },

  _selectMove(e) {
    if (this._marqueeStart) {
      const world = this._getWorldPos(e);
      this.canvas2d.marquee = {
        x1: this._marqueeStart.x,
        y1: this._marqueeStart.y,
        x2: world.x,
        y2: world.y,
      };
      this.onUpdate();
      return;
    }

    if (!this._dragTarget || !this._dragStartPos) return;

    const world = this._getWorldPos(e);
    const dx = world.x - this._dragStartPos.x;
    const dy = world.y - this._dragStartPos.y;

    if (!this._isDragging && Math.hypot(dx, dy) * this.canvas2d.camera.scale > 3) {
      this._isDragging = true;
      beginDrag(this);
    }

    if (!this._isDragging) return;

    const snapped = applySnap(world.x, world.y, this.state, this.canvas2d.camera);

    if (this._dragTarget.type === 'node') {
      previewNode(this, this._dragTarget.id, { x: snapped.x, y: snapped.y });
    } else if (this._dragTarget.type === 'member') {
      const dt = this._dragTarget;
      const member = this.state.getMember(dt.id);
      if (member) {
        const newStartX = snapped.x + dt.offsetStartX;
        const newStartY = snapped.y + dt.offsetStartY;
        const newEndX = snapped.x + dt.offsetEndX;
        const newEndY = snapped.y + dt.offsetEndY;
        previewNode(this, member.startNodeId, { x: newStartX, y: newStartY });
        previewNode(this, member.endNodeId, { x: newEndX, y: newEndY });
      }
    } else if (this._dragTarget.type === 'group') {
      // Snap the drag delta to grid steps so the whole group keeps its shape.
      let gdx = dx;
      let gdy = dy;
      if (this.state.settings.snap) {
        const gridSize = this.state.settings.gridSize || 1;
        gdx = Math.round(dx / gridSize) * gridSize;
        gdy = Math.round(dy / gridSize) * gridSize;
      }
      for (const [nodeId, start] of this._dragTarget.nodeStart) {
        previewNode(this, nodeId, { x: start.x + gdx, y: start.y + gdy });
      }
    }

    this.onUpdate();
  },

  _selectUp(e) {
    if (this._marqueeStart) {
      this._finishMarquee(e);
      return;
    }
    finishDrag(this, true);
    this._dragTarget = null;
    this._isDragging = false;
    this._dragStartPos = null;
    this.onUpdate();
  },

  _finishMarquee(e) {
    const world = this._getWorldPos(e);
    const start = this._marqueeStart;
    this._marqueeStart = null;
    this.canvas2d.marquee = null;

    const movedPx = Math.hypot(world.x - start.x, world.y - start.y) * this.canvas2d.camera.scale;
    if (movedPx <= 3) {
      // Plain click on empty space
      if (!this._marqueeAdditive) this.state.clearSelection();
      this.onUpdate();
      return;
    }

    const hitIds = memberIdsInMarquee(this.state, {
      x1: start.x, y1: start.y, x2: world.x, y2: world.y,
    });

    const ids = this._marqueeAdditive
      ? [...new Set([...this.state.selectedMemberIds, ...hitIds])]
      : hitIds;
    this.state.selectMembers(ids);
    this.onUpdate();
  }
};
