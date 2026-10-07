const STORAGE_KEY = 'lineframe-viewer-tools-layout';
let panelId = 0;

// Keep panel layout separate from the model and the viewer's camera state.
export function mountViewerToolsPanel(host, content, { title, language }) {
  const doc = host.ownerDocument;
  const win = doc.defaultView;
  const container = host.parentElement;
  const ja = language === 'ja';
  const layout = { position: null, collapsed: false };
  try {
    const saved = JSON.parse(win.localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(saved?.position?.x) && Number.isFinite(saved?.position?.y)) {
      layout.position = saved.position;
    }
    layout.collapsed = saved?.collapsed === true;
  } catch { /* Layout remains usable when browser storage is unavailable. */ }
  const save = () => {
    try { win.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout)); } catch { /* Optional preference. */ }
  };
  const listeners = [];
  const listen = (el, type, handler) => {
    el.addEventListener(type, handler);
    listeners.push(() => el.removeEventListener(type, handler));
  };
  const panel = doc.createElement('div');
  panel.className = 'viewer-tools-panel';
  const header = doc.createElement('div');
  header.className = 'viewer-tools-header';
  const handle = doc.createElement('button');
  handle.type = 'button';
  handle.className = 'viewer-tools-drag';
  handle.title = ja
    ? 'ドラッグまたは矢印キーで移動（Shiftで大きく移動、Homeで右上に戻す）'
    : 'Drag or use arrow keys to move (Shift for larger steps, Home to reset)';
  handle.setAttribute('aria-label', ja ? `${title}：パネルを移動` : `${title}: Move panel`);
  const grip = doc.createElement('span');
  grip.className = 'viewer-tools-grip';
  grip.setAttribute('aria-hidden', 'true');
  grip.textContent = '⠿';
  handle.append(grip, doc.createTextNode(title));
  const hint = doc.createElement('span');
  hint.id = `${host.id || `viewer-tools-${++panelId}`}-move-hint`;
  hint.className = 'sr-only';
  hint.textContent = handle.title;
  handle.setAttribute('aria-describedby', hint.id);
  const toggle = doc.createElement('button');
  toggle.type = 'button';
  toggle.className = 'viewer-tools-toggle';
  content.id = `${hint.id}-content`;
  // Stable ID for the application host, including after a language remount.
  if (host.id) content.id = `${host.id}-content`;
  toggle.setAttribute('aria-controls', content.id);
  header.append(handle, toggle, hint);
  content.classList.add('viewer-tools-content');
  panel.append(header, content);
  host.append(panel);

  const place = () => {
    if (!host.offsetWidth || !container.clientWidth || !container.clientHeight) return;
    if (!layout.position) {
      host.style.left = '';
      host.style.top = '';
      host.style.right = '';
      return;
    }
    const maxX = Math.max(12, container.clientWidth - host.offsetWidth - 12);
    const maxY = Math.max(12, container.clientHeight - host.offsetHeight - 12);
    const previous = layout.position;
    layout.position = {
      x: Math.max(12, Math.min(maxX, layout.position.x)),
      y: Math.max(12, Math.min(maxY, layout.position.y)),
    };
    host.style.left = `${layout.position.x}px`;
    host.style.top = `${layout.position.y}px`;
    host.style.right = 'auto';
    // Remember automatic boundary corrections too, so a remount or reload
    // cannot jump back to an old position after the viewport grows again.
    if (previous.x !== layout.position.x || previous.y !== layout.position.y) save();
  };
  const updateCollapsed = () => {
    content.hidden = layout.collapsed;
    toggle.textContent = layout.collapsed ? '+' : '−';
    toggle.setAttribute('aria-expanded', String(!layout.collapsed));
    toggle.title = layout.collapsed
      ? (ja ? '3D表示・出力を展開' : 'Expand 3D view and export')
      : (ja ? '3D表示・出力を折りたたむ' : 'Collapse 3D view and export');
    toggle.setAttribute('aria-label', toggle.title);
    place();
  };
  listen(toggle, 'click', () => {
    layout.collapsed = !layout.collapsed;
    updateCollapsed();
    save();
  });

  let drag = null;
  const finishDrag = event => {
    if (!drag || (event && event.pointerId !== drag.id)) return;
    const id = drag.id;
    drag = null;
    handle.classList.remove('is-dragging');
    if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
    save();
  };
  listen(handle, 'pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary || drag) return;
    event.preventDefault();
    handle.focus({ preventScroll: true });
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: host.offsetLeft, top: host.offsetTop };
    handle.setPointerCapture(event.pointerId);
    handle.classList.add('is-dragging');
  });
  listen(handle, 'pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    layout.position = { x: drag.left + event.clientX - drag.x, y: drag.top + event.clientY - drag.y };
    place();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(handle, type, finishDrag);
  listen(handle, 'keydown', event => {
    const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (!directions[event.key] && event.key !== 'Home') return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Home') layout.position = null;
    else {
      const [dx, dy] = directions[event.key];
      const step = event.shiftKey ? 50 : 10;
      layout.position = { x: host.offsetLeft + dx * step, y: host.offsetTop + dy * step };
    }
    place();
    save();
  });
  // Includes sidebar resizing, content changes, and returning from the 2D tab.
  const observer = new win.ResizeObserver(place);
  observer.observe(container);
  observer.observe(host);
  updateCollapsed();
  return { dispose() {
    finishDrag();
    observer.disconnect();
    for (const remove of listeners) remove();
    panel.remove();
    host.style.left = '';
    host.style.top = '';
    host.style.right = '';
  } };
}
