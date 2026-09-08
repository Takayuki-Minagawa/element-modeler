

// ToolManager delegates to these cohesive behaviors; this is the existing host.
export const supportTool = {
  _supportDown(e) {
    return this._supportPoint(this._getSnappedPos(e));
  },

  _supportPoint(snapped, { exact = false } = {}) {
    const tolerance = exact ? 1 : this._pickTolerance();

    // Check if clicking on an existing support
    const existing = this._findSelectableSupportAt(snapped.x, snapped.y, tolerance);
    if (existing) {
      this.state.select('support', existing.id);
      this.onUpdate();
      return;
    }

    // Place a new support
    const support = this.state.addSupport(snapped.x, snapped.y, {
      levelId: this.state.activeLevelId || 'L0',
    });
    this.state.select('support', support.id);
    this.onUpdate();
  }
};
