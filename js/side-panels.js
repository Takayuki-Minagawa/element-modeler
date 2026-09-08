// side-panels.js - toolbar / property side panel resize and collapse handling.
// DOM lookups happen inside initSidePanels() so module load order stays safe.
// Layout-dependent work (canvas resize, redraw) is injected via onLayoutRefresh.

function buildSidePanelConfig() {
  return {
    toolbar: {
      widthVar: '--toolbar-w',
      storageWidth: 'lineframe-toolbar-width',
      storageCollapsed: 'lineframe-toolbar-collapsed',
      min: 208,
      maxRatio: 0.36,
      defaultWidth: 244,
      button: document.getElementById('btn-toggle-toolbar'),
      resizer: document.getElementById('toolbar-resizer'),
      className: 'toolbar-collapsed',
      collapsedText: '›',
      expandedText: '‹',
      showLabel: 'Show toolbar',
      hideLabel: 'Hide toolbar',
      showTitle: 'ツールパネルを表示',
      hideTitle: 'ツールパネルを隠す',
    },
    property: {
      widthVar: '--panel-w',
      storageWidth: 'lineframe-property-panel-width',
      storageCollapsed: 'lineframe-property-panel-collapsed',
      min: 220,
      maxRatio: 0.42,
      defaultWidth: 284,
      button: document.getElementById('btn-toggle-property'),
      resizer: document.getElementById('property-resizer'),
      className: 'property-collapsed',
      collapsedText: '‹',
      expandedText: '›',
      showLabel: 'Show properties',
      hideLabel: 'Hide properties',
      showTitle: 'プロパティパネルを表示',
      hideTitle: 'プロパティパネルを隠す',
    },
  };
}

export function initSidePanels({ onLayoutRefresh } = {}) {
  const sidePanelConfig = buildSidePanelConfig();
  let layoutRefreshQueued = false;

  function clampPanelWidth(side, width) {
    const cfg = sidePanelConfig[side];
    const max = Math.max(cfg.min, Math.floor(window.innerWidth * cfg.maxRatio));
    return Math.max(cfg.min, Math.min(max, Math.round(width)));
  }

  function getStoredPanelWidth(cfg) {
    const stored = Number(localStorage.getItem(cfg.storageWidth));
    return Number.isFinite(stored) && stored > 0 ? stored : cfg.defaultWidth;
  }

  function applyPanelWidth(side, width, persist = true) {
    const cfg = sidePanelConfig[side];
    const nextWidth = clampPanelWidth(side, width);
    document.documentElement.style.setProperty(cfg.widthVar, `${nextWidth}px`);
    if (persist) localStorage.setItem(cfg.storageWidth, String(nextWidth));
    requestLayoutRefresh();
    return nextWidth;
  }

  function isPanelCollapsed(side) {
    return document.body.classList.contains(sidePanelConfig[side].className);
  }

  function updatePanelToggle(side) {
    const cfg = sidePanelConfig[side];
    if (!cfg.button) return;
    const collapsed = isPanelCollapsed(side);
    cfg.button.textContent = collapsed ? cfg.collapsedText : cfg.expandedText;
    cfg.button.setAttribute('aria-label', collapsed ? cfg.showLabel : cfg.hideLabel);
    cfg.button.title = collapsed ? cfg.showTitle : cfg.hideTitle;
  }

  function setPanelCollapsed(side, collapsed, persist = true) {
    const cfg = sidePanelConfig[side];
    document.body.classList.toggle(cfg.className, collapsed);
    if (persist) localStorage.setItem(cfg.storageCollapsed, collapsed ? '1' : '0');
    updatePanelToggle(side);
    requestLayoutRefresh();
  }

  function requestLayoutRefresh() {
    if (layoutRefreshQueued) return;
    layoutRefreshQueued = true;
    requestAnimationFrame(() => {
      layoutRefreshQueued = false;
      onLayoutRefresh?.();
    });
  }

  for (const side of Object.keys(sidePanelConfig)) {
    const cfg = sidePanelConfig[side];
    applyPanelWidth(side, getStoredPanelWidth(cfg), false);
    const savedCollapsed = localStorage.getItem(cfg.storageCollapsed);
    setPanelCollapsed(side, savedCollapsed === null
      ? side === 'property' && window.innerWidth <= 1000
      : savedCollapsed === '1', false);

    cfg.button?.addEventListener('click', () => {
      setPanelCollapsed(side, !isPanelCollapsed(side));
    });

    cfg.resizer?.addEventListener('pointerdown', (event) => {
      if (event.target.closest('button') || isPanelCollapsed(side)) return;
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = clampPanelWidth(side, getStoredPanelWidth(cfg));
      let currentWidth = startWidth;
      cfg.resizer.classList.add('active');
      document.body.classList.add('resizing-panels');

      const onPointerMove = (moveEvent) => {
        const delta = moveEvent.clientX - startX;
        const nextWidth = side === 'toolbar' ? startWidth + delta : startWidth - delta;
        currentWidth = applyPanelWidth(side, nextWidth, false);
      };
      const finishResize = () => {
        localStorage.setItem(cfg.storageWidth, String(currentWidth));
        cfg.resizer.classList.remove('active');
        document.body.classList.remove('resizing-panels');
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', finishResize);
        window.removeEventListener('pointercancel', finishResize);
      };
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', finishResize, { once: true });
      window.addEventListener('pointercancel', finishResize, { once: true });
    });
  }
  window.addEventListener('resize', () => {
    for (const [side, cfg] of Object.entries(sidePanelConfig)) {
      applyPanelWidth(side, getStoredPanelWidth(cfg), false);
      if (localStorage.getItem(cfg.storageCollapsed) === null) {
        setPanelCollapsed(side, side === 'property' && window.innerWidth <= 1000, false);
      }
    }
  });

}
