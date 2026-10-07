// canvas2d.js - 2D CAD canvas with pan/zoom

import { drawGrid } from './grid.js';
import { FrameScheduler } from './render/frame-scheduler.js';
import { clampPlanScale } from './plan-camera.js';
import { RenderIndex, selectedElements, displayStamp } from './render/model-index.js';
import { cssVar } from './dom-utils.js';
import {
  resolveMemberColor,
  resolveSurfaceColor,
  resolveLoadColor,
  SUPPORT_COLOR,
} from './element-style.js';
import { offsetPolygonOutward } from './geometry-utils.js';
import { isFixedSupport, braceDiagonals, resolveWallDisplayOffset } from './view-semantics.js';
import { roofSlopeArrow } from './roof-geometry.js';
import { isSlopedSurfaceType, isWallSurfaceType } from './state.js';

// Arrowhead geometry presets (screen px). size = leg length from the tip,
// spread = half opening angle. The load arrows keep the previous hard-coded
// triangles: "back" px behind the tip and "halfWidth" px to each side.
const ROOF_SLOPE_ARROW_HEAD = { size: 7, spread: Math.PI / 6 };
const FLOOR_LOAD_ARROW_HEAD = { size: 7, spread: Math.PI / 7 };
const DOWN_ARROW_HEAD = { size: Math.hypot(6, 4), spread: Math.atan2(4, 6) }; // 6 back, 4 half-width
const LINE_LOAD_ARROW_HEAD = { size: Math.hypot(4, 3), spread: Math.atan2(3, 4) }; // 4 back, 3 half-width

// V-brace triangle height (screen px) for the 2D panel outline.
const VBRACE_TRIANGLE_HEIGHT_PX = 14;
// Support symbol size (screen px) and base-offset factor.
const SUPPORT_SYMBOL_SIZE_PX = 12;
const SUPPORT_BASE_FACTOR = 1.4;

export class Canvas2D {
  constructor(canvasEl, state) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d');
    this.state = state;
    this._disposed = false;
    this._dirty = true;
    this._index = new RenderIndex();
    this._frames = new FrameScheduler(() => this.draw());
    this.stats = { frames: 0 };
    // Legacy tools assign these before onUpdate, and sometimes mutate a field
    // in place. Assignments and input events both invalidate the next frame.
    for (const key of ['preview', 'measure', 'marquee']) {
      let value = null;
      Object.defineProperty(this, key, {
        get: () => value,
        set: next => { value = next; this.requestDraw(); },
      });
    }
    this._onInput = () => this.requestDraw();
    this._inputEvents = ['pointermove', 'mousemove', 'pointerdown', 'pointerup', 'pointercancel', 'wheel'];
    for (const event of this._inputEvents) this.canvas.addEventListener(event, this._onInput);
    window.addEventListener('keydown', this._onInput);
    window.addEventListener('keyup', this._onInput);

    // Camera: world-to-screen transform
    // screenX = worldX * scale + offsetX
    this.camera = {
      offsetX: 0,
      offsetY: 0,
      scale: 0.05, // pixels per mm (50px per 1000mm)
    };
    this._cameraInitialized = false;

    // Temporary drawing state
    this.preview = null; // { ... , mode: 'line'|'rect'|'polyline'|'point' }
    this.marquee = null; // { x1, y1, x2, y2 } world coords (rect selection)
    this.measure = null; // { x1, y1, x2, y2, done } world coords

    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(this.canvas.parentElement);
    this.resize();
  }

  resize() {
    // The shared container grows when the plan toolbar is hidden in 3D.
    // Retain the last visible plan viewport so hidden PNG exports keep its framing.
    if (this._disposed || this.canvas.hidden) return;
    const parent = this.canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = parent.clientWidth * dpr;
    this.canvas.height = parent.clientHeight * dpr;
    this.canvas.style.width = parent.clientWidth + 'px';
    this.canvas.style.height = parent.clientHeight + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.logicalWidth = parent.clientWidth;
    this.logicalHeight = parent.clientHeight;

    if (!this._cameraInitialized && this.logicalWidth > 0 && this.logicalHeight > 0) {
      this._setInitialOriginNearBottomLeft();
    }
    this.requestDraw();
  }

  _setInitialOriginNearBottomLeft() {
    const margin = 80;
    this.camera.offsetX = margin;
    this.camera.offsetY = Math.max(margin, this.logicalHeight - margin);
    this._cameraInitialized = true;
  }

  screenToWorld(sx, sy) {
    return {
      x: (sx - this.camera.offsetX) / this.camera.scale,
      y: (this.camera.offsetY - sy) / this.camera.scale,
    };
  }

  worldToScreen(wx, wy) {
    return {
      x: wx * this.camera.scale + this.camera.offsetX,
      y: this.camera.offsetY - wy * this.camera.scale,
    };
  }

  zoom(delta, sx, sy) {
    const factor = delta > 0 ? 0.9 : 1.1;
    const newScale = clampPlanScale(this.camera.scale * factor);
    const ratio = newScale / this.camera.scale;
    this.camera.offsetX = sx - (sx - this.camera.offsetX) * ratio;
    this.camera.offsetY = sy - (sy - this.camera.offsetY) * ratio;
    this.camera.scale = newScale;
    this.requestDraw();
  }

  pan(dx, dy) {
    this.camera.offsetX += dx;
    this.camera.offsetY += dy;
    this.requestDraw();
  }

  requestDraw() {
    if (this._disposed) return;
    this._dirty = true;
    if (this.canvas.hidden) this._frames.setActive(false);
    this._frames.invalidate();
  }

  setActive(active) {
    this._frames.setActive(active);
    if (active) this.resize();
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._frames.dispose();
    this._resizeObserver.disconnect();
    for (const event of this._inputEvents) this.canvas.removeEventListener(event, this._onInput);
    window.removeEventListener('keydown', this._onInput);
    window.removeEventListener('keyup', this._onInput);
    this._index = null;
  }

  draw({ force = false } = {}) {
    if (this._disposed || (!force && (!this._frames.active || this.canvas.hidden))) return;
    const indexed = this._index.update(this.state, force);
    const selection = selectedElements(this.state);
    const stamp = JSON.stringify([displayStamp(this.state), [...selection.keys()], this.camera,
      this.preview, this.measure, this.marquee]);
    // PNG export needs a current bitmap even when the view is inactive/hidden.
    // A forced synchronous draw bypasses caches without activating the view or
    // requesting a frame; normal idle calls still do no canvas work.
    if (!force && !this._dirty && !indexed && this._drawStamp === stamp) return;
    this._dirty = false;
    this._drawStamp = stamp;
    this._selectedMemberIds = new Set([...selection.values()].filter(p => p.kind === 'member').map(p => p.id));
    this._selectedNodeIds = new Set();
    if (this.state.selectedNodeId !== null && this.state.selectedNodeId !== undefined) this._selectedNodeIds.add(this.state.selectedNodeId);
    for (const id of this._selectedMemberIds) {
      const member = this._index.membersById.get(id);
      if (member) {
        this._selectedNodeIds.add(member.startNodeId);
        this._selectedNodeIds.add(member.endNodeId);
      }
    }
    this.stats.frames++;
    const ctx = this.ctx;
    const w = this.logicalWidth;
    const h = this.logicalHeight;

    ctx.fillStyle = cssVar('--canvas-bg');
    ctx.fillRect(0, 0, w, h);

    const nodeColor = cssVar('--node-color');
    const selectedColor = cssVar('--node-selected');
    const previewColor = cssVar('--preview-color');
    const memberDefault = cssVar('--member-default');

    drawGrid(ctx, this.camera, this.state.settings.gridSize, w, h);

    this._drawUnderlay(ctx);
    this._drawAxes(ctx, w, h);
    this._drawSurfaces(ctx, selectedColor);
    this._drawLoads(ctx, selectedColor);
    this._drawSupports(ctx, selectedColor);
    const visibleNodeAlpha = this._drawMembers(ctx, selectedColor, memberDefault);
    this._drawNodes(ctx, visibleNodeAlpha, nodeColor, selectedColor);
    this._drawPreview(ctx, previewColor);
    this._drawMarquee(ctx, previewColor);
    this._drawMeasure(ctx, previewColor);
  }

  // Imported DXF underlay: thin halftone strokes beneath the model.
  _drawUnderlay(ctx) {
    const underlay = this.state.underlay;
    if (!underlay || this.state.settings.showUnderlay === false) return;

    ctx.save();
    ctx.strokeStyle = cssVar('--underlay-color') || '#7a7a8a';
    ctx.globalAlpha *= 0.55;
    ctx.lineWidth = 1;

    for (const e of underlay.entities) {
      ctx.beginPath();
      if (e.type === 'line') {
        const p1 = this.worldToScreen(e.x1, e.y1);
        const p2 = this.worldToScreen(e.x2, e.y2);
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
      } else if (e.type === 'polyline' && Array.isArray(e.points) && e.points.length >= 2) {
        const pts = e.points.map(p => this.worldToScreen(p.x, p.y));
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        if (e.closed) ctx.closePath();
      } else if (e.type === 'circle') {
        const c = this.worldToScreen(e.cx, e.cy);
        ctx.arc(c.x, c.y, e.r * this.camera.scale, 0, Math.PI * 2);
      } else if (e.type === 'arc') {
        const c = this.worldToScreen(e.cx, e.cy);
        // World Y-up to screen Y-down flips angle direction.
        const start = -(e.startAngle * Math.PI) / 180;
        const end = -(e.endAngle * Math.PI) / 180;
        ctx.arc(c.x, c.y, e.r * this.camera.scale, start, end, true);
      } else {
        continue;
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // Grid axes (通り芯): dash-dot lines with name bubbles at the canvas edge.
  _drawAxes(ctx, w, h) {
    if (!this.state.settings.showAxes || !this.state.axes?.length) return;
    const color = cssVar('--axis-color') || '#c084fc';

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([14, 4, 3, 4]);
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const axis of this.state.axes) {
      if (axis.dir === 'x') {
        const sx = axis.coord * this.camera.scale + this.camera.offsetX;
        if (sx < -20 || sx > w + 20) continue;
        ctx.beginPath();
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, h);
        ctx.stroke();
        this._drawAxisLabel(ctx, axis.name, sx, 14, color);
      } else {
        const sy = this.camera.offsetY - axis.coord * this.camera.scale;
        if (sy < -20 || sy > h + 20) continue;
        ctx.beginPath();
        ctx.moveTo(0, sy);
        ctx.lineTo(w, sy);
        ctx.stroke();
        this._drawAxisLabel(ctx, axis.name, 18, sy, color);
      }
    }
    ctx.restore();
  }

  _drawAxisLabel(ctx, name, x, y, color) {
    const label = String(name || '');
    if (!label) return;
    ctx.save();
    ctx.setLineDash([]);
    const r = Math.max(10, ctx.measureText(label).width / 2 + 5);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(20, 22, 34, 0.85)';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillText(label, x, y + 0.5);
    ctx.restore();
  }

  _drawMarquee(ctx, previewColor) {
    if (!this.marquee) return;
    const p1 = this.worldToScreen(this.marquee.x1, this.marquee.y1);
    const p2 = this.worldToScreen(this.marquee.x2, this.marquee.y2);
    ctx.save();
    ctx.strokeStyle = previewColor;
    ctx.fillStyle = toRgba(previewColor, 0.08);
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    ctx.rect(
      Math.min(p1.x, p2.x),
      Math.min(p1.y, p2.y),
      Math.abs(p2.x - p1.x),
      Math.abs(p2.y - p1.y)
    );
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  _drawMeasure(ctx, previewColor) {
    if (!this.measure) return;
    const { x1, y1, x2, y2 } = this.measure;
    const p1 = this.worldToScreen(x1, y1);
    const p2 = this.worldToScreen(x2, y2);

    ctx.save();
    ctx.strokeStyle = previewColor;
    ctx.fillStyle = previewColor;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const p of [p1, p2]) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    const dx = Math.round(x2 - x1);
    const dy = Math.round(y2 - y1);
    const len = Math.round(Math.hypot(dx, dy));
    const label = `L=${len}  dX=${dx}  dY=${dy}`;
    this._drawPreviewLabel(ctx, label, (p1.x + p2.x) / 2 + 8, (p1.y + p2.y) / 2 - 8, previewColor);
    ctx.restore();
  }

  // Draws all visible members and returns a Map of nodeId -> strongest alpha
  // of the members touching that node (used to fade nodes with their layer).
  _drawMembers(ctx, selectedColor, memberDefault) {
    const visibleNodeAlpha = new Map();
    for (const m of this.state.members) {
      if (!this.state.isMemberVisible(m, '2d')) continue;
      const layerStyle = this.state.getPlanLayerStyle(m.levelId);
      const n1 = this._index.nodesById.get(m.startNodeId);
      const n2 = this._index.nodesById.get(m.endNodeId);
      if (!n1 || !n2) continue;

      const isSelected = this._selectedMemberIds.has(m.id);
      const alpha = isSelected ? 1 : layerStyle.alpha;
      visibleNodeAlpha.set(n1.id, Math.max(visibleNodeAlpha.get(n1.id) || 0, alpha));
      visibleNodeAlpha.set(n2.id, Math.max(visibleNodeAlpha.get(n2.id) || 0, alpha));

      ctx.save();
      ctx.globalAlpha *= alpha;
      if (m.type === 'column') {
        this._drawColumn(ctx, m, n1, isSelected, selectedColor, memberDefault);
      } else if (m.type === 'vbrace') {
        this._drawVBrace(ctx, m, n1, n2, isSelected, selectedColor, memberDefault);
      } else {
        this._drawMemberLine(ctx, m, n1, n2, isSelected, selectedColor);
      }
      if (this.state.settings.showMemberEndSymbols) this._drawMemberEndSymbols(ctx, m, n1, n2, selectedColor);
      ctx.restore();
    }
    return visibleNodeAlpha;
  }

  _drawMemberLine(ctx, m, n1, n2, isSelected, selectedColor) {
    const s1 = this.worldToScreen(n1.x, n1.y);
    const s2 = this.worldToScreen(n2.x, n2.y);

    ctx.save();
    ctx.strokeStyle = isSelected ? selectedColor : resolveMemberColor(m);
    ctx.lineWidth = isSelected ? 3 : 2;
    if (m.type === 'brace' || m.type === 'hbrace') {
      ctx.setLineDash([7, 4]);
    }
    ctx.beginPath();
    ctx.moveTo(s1.x, s1.y);
    ctx.lineTo(s2.x, s2.y);
    ctx.stroke();
    ctx.restore();
  }

  _drawNodes(ctx, visibleNodeAlpha, nodeColor, selectedColor) {
    for (const n of this.state.nodes) {
      let nodeAlpha = visibleNodeAlpha.get(n.id);
      if (!nodeAlpha) {
        const isMemberNode = this._index.memberNodeIds.has(n.id);
        if (isMemberNode) continue;
        nodeAlpha = 1;
      }
      const s = this.worldToScreen(n.x, n.y);
      const isEndOfSelected = this._selectedNodeIds.has(n.id);

      ctx.save();
      ctx.globalAlpha *= isEndOfSelected ? 1 : nodeAlpha;
      ctx.fillStyle = isEndOfSelected ? selectedColor : nodeColor;
      ctx.beginPath();
      ctx.arc(s.x, s.y, isEndOfSelected ? 5 : 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  _drawPreview(ctx, previewColor) {
    if (!this.preview) return;

    ctx.save();
    ctx.strokeStyle = previewColor;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    if (this.preview.mode === 'point') {
      const point = this.worldToScreen(this.preview.x, this.preview.y);
      ctx.arc(point.x, point.y, 6, 0, Math.PI * 2);
      ctx.moveTo(point.x - 10, point.y);
      ctx.lineTo(point.x + 10, point.y);
      ctx.moveTo(point.x, point.y - 10);
      ctx.lineTo(point.x, point.y + 10);
    } else if (this.preview.mode === 'rect') {
      const s1 = this.worldToScreen(this.preview.startX, this.preview.startY);
      const s2 = this.worldToScreen(this.preview.endX, this.preview.endY);
      const x = Math.min(s1.x, s2.x);
      const y = Math.min(s1.y, s2.y);
      const ww = Math.abs(s2.x - s1.x);
      const hh = Math.abs(s2.y - s1.y);
      ctx.rect(x, y, ww, hh);
    } else if (this.preview.mode === 'polyline' && Array.isArray(this.preview.points)) {
      const pts = this.preview.points.map(p => this.worldToScreen(p.x, p.y));
      if (pts.length > 0) {
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i].x, pts[i].y);
        }
      }
    } else {
      const s1 = this.worldToScreen(this.preview.startX, this.preview.startY);
      const s2 = this.worldToScreen(this.preview.endX, this.preview.endY);
      ctx.moveTo(s1.x, s1.y);
      ctx.lineTo(s2.x, s2.y);
    }
    ctx.stroke();
    if (this.preview.label && this.state.settings.showPlacementLabels !== false) {
      const labelPoint = this._previewLabelPoint();
      this._drawPreviewLabel(ctx, this.preview.label, labelPoint.x + 8, labelPoint.y - 8, previewColor);
    }
    ctx.restore();
  }

  // Fills a triangular arrowhead whose tip is at (x, y), pointing along
  // `angle` (radians, screen space). Callers set ctx.fillStyle beforehand.
  _drawArrowHead(ctx, x, y, angle, { size, spread }) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - size * Math.cos(angle - spread), y - size * Math.sin(angle - spread));
    ctx.lineTo(x - size * Math.cos(angle + spread), y - size * Math.sin(angle + spread));
    ctx.closePath();
    ctx.fill();
  }

  _previewLabelPoint() {
    if (this.preview?.mode === 'point') {
      return this.worldToScreen(this.preview.x, this.preview.y);
    }
    if (this.preview?.mode === 'polyline' && Array.isArray(this.preview.points) && this.preview.points.length) {
      const last = this.preview.points[this.preview.points.length - 1];
      return this.worldToScreen(last.x, last.y);
    }
    return this.worldToScreen(this.preview.endX, this.preview.endY);
  }

  _drawPreviewLabel(ctx, text, x, y, color) {
    const label = String(text || '').trim();
    if (!label) return;
    ctx.save();
    ctx.font = '11px system-ui, sans-serif';
    const width = ctx.measureText(label).width + 12;
    ctx.fillStyle = 'rgba(20, 22, 34, 0.88)';
    ctx.strokeStyle = toRgba(color, 0.65);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y - 17, width, 20, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#e5e7eb';
    ctx.fillText(label, x + 6, y - 3);
    ctx.restore();
  }

  _drawMemberEndSymbols(ctx, member, n1, n2, selectedColor) {
    const color = this._selectedMemberIds.has(member.id) ? selectedColor : resolveMemberColor(member);
    const draw = (node, end, label) => {
      const p = this.worldToScreen(node.x, node.y);
      const symbol = endSymbol(end);
      ctx.save();
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(20, 22, 34, 0.86)';
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(p.x - 12, p.y - 24, 24, 14, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#f8fafc';
      ctx.fillText(`${label}:${symbol}`, p.x, p.y - 17);
      ctx.restore();
    };
    draw(n1, member.endI, 'I');
    draw(n2, member.endJ, 'J');
  }

  _drawColumn(ctx, member, node, isSelected, selectedColor, memberDefault) {
    const s = this.worldToScreen(node.x, node.y);
    const r = Math.max(4, (member.section.b / 2) * this.camera.scale);
    const color = isSelected ? selectedColor : (member.color || memberDefault);

    ctx.save();
    ctx.fillStyle = toRgba(color, 0.5);
    ctx.strokeStyle = color;
    ctx.lineWidth = isSelected ? 3 : 2;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(s.x - r, s.y);
    ctx.lineTo(s.x + r, s.y);
    ctx.moveTo(s.x, s.y - r);
    ctx.lineTo(s.x, s.y + r);
    ctx.stroke();
    ctx.restore();
  }

  _drawVBrace(ctx, member, n1, n2, isSelected, selectedColor, memberDefault) {
    const offset = resolveWallDisplayOffset(this.state.settings);

    // Direction and perpendicular in world space
    const dx = n2.x - n1.x;
    const dy = n2.y - n1.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;

    const px = -dy / len;
    const py = dx / len;

    // Offset node positions in world space
    const w1 = { x: n1.x + px * offset, y: n1.y + py * offset };
    const w2 = { x: n2.x + px * offset, y: n2.y + py * offset };

    // Convert to screen
    const s1 = this.worldToScreen(w1.x, w1.y);
    const s2 = this.worldToScreen(w2.x, w2.y);

    // Screen perpendicular for triangle height
    const sdx = s2.x - s1.x;
    const sdy = s2.y - s1.y;
    const slen = Math.hypot(sdx, sdy);
    if (slen < 4) return;

    const triH = VBRACE_TRIANGLE_HEIGHT_PX;
    const spx = (-sdy / slen) * triH;
    const spy = (sdx / slen) * triH;

    // Rectangle corners: s1-s2 top edge, s4-s3 bottom edge
    const s3 = { x: s2.x + spx, y: s2.y + spy };
    const s4 = { x: s1.x + spx, y: s1.y + spy };

    const color = isSelected ? selectedColor : (member.color || memberDefault);

    ctx.save();

    // Rectangle outline
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(s1.x, s1.y);
    ctx.lineTo(s2.x, s2.y);
    ctx.lineTo(s3.x, s3.y);
    ctx.lineTo(s4.x, s4.y);
    ctx.closePath();
    ctx.stroke();

    // Diagonals. Corner order matches braceDiagonals():
    // [start-bottom, end-bottom, end-top, start-top] = [s4, s3, s2, s1].
    const corners = [s4, s3, s2, s1];
    ctx.lineWidth = isSelected ? 2.5 : 1.5;
    for (const [a, b] of braceDiagonals(member.bracePattern)) {
      ctx.beginPath();
      ctx.moveTo(corners[a].x, corners[a].y);
      ctx.lineTo(corners[b].x, corners[b].y);
      ctx.stroke();
    }

    // Panel fill over the diagonals: full rectangle for cross, right triangle
    // (s1, s2, s4) for a single diagonal.
    ctx.fillStyle = toRgba(color, 0.12);
    ctx.beginPath();
    ctx.moveTo(s1.x, s1.y);
    ctx.lineTo(s2.x, s2.y);
    if (member.bracePattern === 'cross') ctx.lineTo(s3.x, s3.y);
    ctx.lineTo(s4.x, s4.y);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  _drawSurfaceLine(ctx, s, isSelected, selectedColor, wallOffset) {
    const p1 = this.worldToScreen(s.x1 + wallOffset, s.y1 + wallOffset);
    const p2 = this.worldToScreen(s.x2 + wallOffset, s.y2 + wallOffset);
    const color = isSelected ? selectedColor : resolveSurfaceColor(s);

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = isSelected ? 3 : 2;
    ctx.setLineDash(wallDash(s));
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    ctx.restore();
  }

  _drawSurfaces(ctx, selectedColor) {
    const wallOffset = resolveWallDisplayOffset(this.state.settings);

    for (const s of this.state.surfaces) {
      if (!this.state.isSurfaceVisible(s, '2d')) continue;
      const layerStyle = this.state.getPlanLayerStyle(s.levelId);
      const isWall = isWallSurfaceType(s.type);
      const isSelected = s.id === this.state.selectedSurfaceId;
      const surfaceColor = resolveSurfaceColor(s);
      const isPolygon = s.shape === 'polygon' && Array.isArray(s.points);
      const alpha = isSelected ? 1 : layerStyle.alpha;

      ctx.save();
      ctx.globalAlpha *= alpha;

      if (isPolygon) {
        const offset = isWall ? wallOffset : 0;
        const points = s.points.map(p => ({
          x: p.x + offset,
          y: p.y + offset,
        }));
        if (s.type === 'exteriorWall') {
          this._drawExteriorWallEdges(ctx, points, s, isSelected, selectedColor);
        } else {
          this._drawSurfacePolygon(ctx, points, s, isSelected, isWall, selectedColor);
        }
        if (isSlopedSurfaceType(s.type)) this._drawRoofSlopeArrow(ctx, s, selectedColor, isSelected);
        ctx.restore();
        continue;
      }

      if (s.shape === 'line') {
        this._drawSurfaceLine(ctx, s, isSelected, selectedColor, wallOffset);
        ctx.restore();
        continue;
      }

      const x1 = isWall ? s.x1 + wallOffset : s.x1;
      const y1 = isWall ? s.y1 + wallOffset : s.y1;
      const x2 = isWall ? s.x2 + wallOffset : s.x2;
      const y2 = isWall ? s.y2 + wallOffset : s.y2;

      const p1 = this.worldToScreen(x1, y1);
      const p2 = this.worldToScreen(x2, y2);
      const sx = Math.min(p1.x, p2.x);
      const sy = Math.min(p1.y, p2.y);
      const sw = Math.abs(p2.x - p1.x);
      const sh = Math.abs(p2.y - p1.y);

      ctx.save();
      ctx.fillStyle = toRgba(surfaceColor, isWall ? 0.22 : 0.26);
      ctx.strokeStyle = isSelected ? selectedColor : surfaceColor;
      ctx.lineWidth = isSelected ? 2.5 : 1.5;
      if (isWall) ctx.setLineDash(wallDash(s));
      ctx.beginPath();
      ctx.rect(sx, sy, sw, sh);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      if (s.type === 'floor') {
        this._drawLoadArrow(ctx, sx, sy, sw, sh, s.loadDirection);
      } else if (isSlopedSurfaceType(s.type)) {
        this._drawRoofSlopeArrow(ctx, s, selectedColor, isSelected);
      }
      ctx.restore();
    }
  }

  _drawSurfacePolygon(ctx, points, s, isSelected, isWall, selectedColor) {
    if (!points.length) return;
    const screenPoints = points.map(p => this.worldToScreen(p.x, p.y));
    const surfaceColor = resolveSurfaceColor(s);
    ctx.save();
    ctx.fillStyle = toRgba(surfaceColor, isWall ? 0.22 : 0.26);
    ctx.strokeStyle = isSelected ? selectedColor : surfaceColor;
    ctx.lineWidth = isSelected ? 2.5 : 1.5;
    if (isWall) ctx.setLineDash(wallDash(s));
    ctx.beginPath();
    ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
    for (let i = 1; i < screenPoints.length; i++) {
      ctx.lineTo(screenPoints[i].x, screenPoints[i].y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    if (s.type === 'floor') {
      const bounds = polygonBounds(screenPoints);
      this._drawLoadArrow(ctx, bounds.x, bounds.y, bounds.w, bounds.h, s.loadDirection);
    }
  }

  _drawRoofSlopeArrow(ctx, surface, selectedColor, isSelected) {
    const arrow = roofSlopeArrow(surface);
    if (!arrow) return;
    const p1 = this.worldToScreen(arrow.x1, arrow.y1);
    const p2 = this.worldToScreen(arrow.x2, arrow.y2);
    const color = isSelected ? selectedColor : resolveSurfaceColor(surface);
    const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = isSelected ? 2.5 : 1.7;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    this._drawArrowHead(ctx, p2.x, p2.y, angle, ROOF_SLOPE_ARROW_HEAD);
    ctx.restore();
  }

  _drawExteriorWallEdges(ctx, points, s, isSelected, selectedColor) {
    if (points.length < 2) return;
    const surfaceColor = resolveSurfaceColor(s);

    const offset = resolveWallDisplayOffset(this.state.settings);
    const oPts = offsetPolygonOutward(points, offset);
    const screenOff = oPts.map(p => this.worldToScreen(p.x, p.y));
    const screenOrig = points.map(p => this.worldToScreen(p.x, p.y));

    ctx.save();

    // Thick semi-transparent closed polygon (outward offset)
    ctx.strokeStyle = isSelected ? selectedColor : toRgba(surfaceColor, 0.5);
    ctx.lineWidth = isSelected ? 7 : 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (s.heightMode && s.heightMode !== 'full') ctx.setLineDash([10, 4]);
    ctx.beginPath();
    ctx.moveTo(screenOff[0].x, screenOff[0].y);
    for (let i = 1; i < screenOff.length; i++) {
      ctx.lineTo(screenOff[i].x, screenOff[i].y);
    }
    ctx.closePath();
    ctx.stroke();

    // Thin dashed line at original polygon position
    ctx.strokeStyle = isSelected ? selectedColor : surfaceColor;
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.setLineDash(wallDash(s));
    ctx.beginPath();
    ctx.moveTo(screenOrig[0].x, screenOrig[0].y);
    for (let i = 1; i < screenOrig.length; i++) {
      ctx.lineTo(screenOrig[i].x, screenOrig[i].y);
    }
    ctx.closePath();
    ctx.stroke();

    ctx.restore();
  }

  _drawLoads(ctx, selectedColor) {
    for (const ld of this.state.loads) {
      if (!this.state.isLoadVisible(ld, '2d')) continue;
      const layerStyle = this.state.getPlanLayerStyle(ld.levelId);
      const isSelected = ld.id === this.state.selectedLoadId;
      ctx.save();
      ctx.globalAlpha *= isSelected ? 1 : layerStyle.alpha;
      if (ld.type === 'areaLoad') {
        this._drawAreaLoad(ctx, ld, isSelected, selectedColor);
      } else if (ld.type === 'lineLoad') {
        this._drawLineLoad(ctx, ld, isSelected, selectedColor);
      } else if (ld.type === 'pointLoad') {
        this._drawPointLoad(ctx, ld, isSelected, selectedColor);
      }
      ctx.restore();
    }
  }

  _drawAreaLoad(ctx, ld, isSelected, selectedColor) {
    const p1 = this.worldToScreen(ld.x1, ld.y1);
    const p2 = this.worldToScreen(ld.x2, ld.y2);
    const x = Math.min(p1.x, p2.x), y = Math.min(p1.y, p2.y);
    const w = Math.abs(p2.x - p1.x), h = Math.abs(p2.y - p1.y);
    const color = isSelected ? selectedColor : resolveLoadColor(ld);

    ctx.save();
    ctx.fillStyle = toRgba(color, 0.18);
    ctx.strokeStyle = color;
    ctx.lineWidth = isSelected ? 2.5 : 1.5;
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.fill();
    ctx.stroke();

    // Down arrow at center
    if (w > 20 && h > 20) {
      const cx = x + w / 2, cy = y + h / 2;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 10);
      ctx.lineTo(cx, cy + 10);
      ctx.stroke();
      this._drawArrowHead(ctx, cx, cy + 10, Math.PI / 2, DOWN_ARROW_HEAD);
    }

    // Value text
    if (ld.value !== 0 && w > 30) {
      ctx.fillStyle = color;
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${ld.value} N/m²`, x + w / 2, y + h / 2 + 22);
    }
    ctx.restore();
  }

  _drawLineLoad(ctx, ld, isSelected, selectedColor) {
    const p1 = this.worldToScreen(ld.x1, ld.y1);
    const p2 = this.worldToScreen(ld.x2, ld.y2);
    const color = isSelected ? selectedColor : resolveLoadColor(ld);
    const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = isSelected ? 4 : 3;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();

    // Distributed arrows along the line
    if (len > 20) {
      const count = Math.max(2, Math.floor(len / 30));
      ctx.fillStyle = color;
      ctx.lineWidth = 1;
      for (let i = 0; i <= count; i++) {
        const t = i / count;
        const ax = p1.x + (p2.x - p1.x) * t;
        const ay = p1.y + (p2.y - p1.y) * t;
        // Small down arrow
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax, ay + 8);
        ctx.stroke();
        this._drawArrowHead(ctx, ax, ay + 8, Math.PI / 2, LINE_LOAD_ARROW_HEAD);
      }
    }

    // Value text at midpoint
    if (ld.value !== 0 && len > 30) {
      ctx.fillStyle = color;
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${ld.value} N/m`, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2 + 20);
    }
    ctx.restore();
  }

  _drawPointLoad(ctx, ld, isSelected, selectedColor) {
    const p = this.worldToScreen(ld.x1, ld.y1);
    const color = isSelected ? selectedColor : resolveLoadColor(ld);
    const r = 8;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = isSelected ? 3 : 2;

    // Cross mark
    ctx.beginPath();
    ctx.moveTo(p.x - r, p.y);
    ctx.lineTo(p.x + r, p.y);
    ctx.moveTo(p.x, p.y - r);
    ctx.lineTo(p.x, p.y + r);
    ctx.stroke();

    // Circle
    ctx.fillStyle = toRgba(color, 0.3);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Force arrow if fz != 0 (down arrow for positive)
    if (ld.fz !== 0) {
      const dir = ld.fz > 0 ? 1 : -1;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y + dir * (r + 2));
      ctx.lineTo(p.x, p.y + dir * (r + 14));
      ctx.stroke();
      this._drawArrowHead(ctx, p.x, p.y + dir * (r + 14), dir * (Math.PI / 2), DOWN_ARROW_HEAD);
    }
    ctx.restore();
  }

  _drawLoadArrow(ctx, x, y, w, h, dir) {
    const minSpan = 20;
    if (w < minSpan || h < minSpan) return;
    ctx.save();
    ctx.strokeStyle = '#facc15';
    ctx.fillStyle = '#facc15';
    ctx.lineWidth = 1.5;

    if (dir === 'x' || dir === 'twoWay') {
      const yMid = y + h * 0.5;
      this._arrowLine(ctx, x + w * 0.18, yMid, x + w * 0.82, yMid);
    }
    if (dir === 'y' || dir === 'twoWay') {
      const xMid = x + w * 0.5;
      this._arrowLine(ctx, xMid, y + h * 0.82, xMid, y + h * 0.18);
    }

    ctx.restore();
  }

  _arrowLine(ctx, x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    const angle = Math.atan2(y2 - y1, x2 - x1);
    // 終点矢印 / 始点矢印 (both ends, pointing outward)
    this._drawArrowHead(ctx, x2, y2, angle, FLOOR_LOAD_ARROW_HEAD);
    this._drawArrowHead(ctx, x1, y1, angle + Math.PI, FLOOR_LOAD_ARROW_HEAD);
  }

  _drawSupports(ctx, selectedColor) {
    if (!this.state.settings.showSupports) return;
    for (const sup of this.state.supports) {
      if (!this.state.isSupportVisible(sup, '2d')) continue;
      const layerStyle = this.state.getPlanLayerStyle(sup.levelId);
      const isSelected = sup.id === this.state.selectedSupportId;
      ctx.save();
      ctx.globalAlpha *= isSelected ? 1 : layerStyle.alpha;
      this._drawSupport(ctx, sup, isSelected, selectedColor);
      ctx.restore();
    }
  }

  _drawSupport(ctx, sup, isSelected, selectedColor) {
    const p = this.worldToScreen(sup.x, sup.y);
    const color = isSelected ? selectedColor : SUPPORT_COLOR;
    const sz = SUPPORT_SYMBOL_SIZE_PX;
    const baseOffset = sz * SUPPORT_BASE_FACTOR;

    ctx.save();

    const isFixed = isFixedSupport(sup);

    // Triangle: apex at support point, base below
    ctx.strokeStyle = color;
    ctx.lineWidth = isSelected ? 2.5 : 2;
    ctx.fillStyle = toRgba(color, 0.25);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x - sz, p.y + baseOffset);
    ctx.lineTo(p.x + sz, p.y + baseOffset);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    if (isFixed) {
      // Fixed support: ground line + hatching
      const baseY = p.y + baseOffset;
      ctx.beginPath();
      ctx.moveTo(p.x - sz - 3, baseY);
      ctx.lineTo(p.x + sz + 3, baseY);
      ctx.stroke();
      // Hatching lines
      for (let i = -sz; i <= sz; i += 5) {
        ctx.beginPath();
        ctx.moveTo(p.x + i, baseY);
        ctx.lineTo(p.x + i - 4, baseY + 6);
        ctx.stroke();
      }
    } else {
      // Roller / partial: small circles under base
      const baseY = p.y + baseOffset;
      ctx.beginPath();
      ctx.moveTo(p.x - sz - 3, baseY + 5);
      ctx.lineTo(p.x + sz + 3, baseY + 5);
      ctx.stroke();
    }

    // DOF labels
    const dofs = [];
    if (sup.dx) dofs.push('DX');
    if (sup.dy) dofs.push('DY');
    if (sup.dz) dofs.push('DZ');
    if (sup.rx) dofs.push('RX');
    if (sup.ry) dofs.push('RY');
    if (sup.rz) dofs.push('RZ');
    if (dofs.length > 0 && dofs.length < 6) {
      ctx.fillStyle = color;
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(dofs.join(','), p.x, p.y + baseOffset + 18);
    }

    ctx.restore();
  }
}

function toRgba(hex, alpha) {
  const h = (hex || '#67a9cf').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function wallDash(surface) {
  return surface.heightMode && surface.heightMode !== 'full' ? [8, 3, 2, 3] : [4, 3];
}

function endSymbol(end) {
  if (end?.condition === 'rigid') return 'R';
  if (end?.condition === 'spring') return 'S';
  return 'P';
}

function polygonBounds(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
