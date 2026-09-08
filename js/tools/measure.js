

// ToolManager delegates to these cohesive behaviors; this is the existing host.
export const measureTool = {
  _measureDown(e) {
    return this._measurePoint(this._getSnappedPos(e));
  },

  _measurePoint(snapped) {
    if (!this._measureStart) {
      this._measureStart = { x: snapped.x, y: snapped.y };
      this.canvas2d.measure = null;
      this.onUpdate();
      return;
    }
    this.canvas2d.measure = {
      x1: this._measureStart.x,
      y1: this._measureStart.y,
      x2: snapped.x,
      y2: snapped.y,
      done: true,
    };
    this._measureStart = null;
    this.onUpdate();
  },

  _measureMove(e) {
    if (!this._measureStart) return;
    const snapped = this._getSnappedPos(e);
    this.canvas2d.measure = {
      x1: this._measureStart.x,
      y1: this._measureStart.y,
      x2: snapped.x,
      y2: snapped.y,
      done: false,
    };
    this.onUpdate();
  }
};
