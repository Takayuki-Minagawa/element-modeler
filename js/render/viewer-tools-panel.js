const STORAGE_KEY = 'lineframe-viewer-tools-layout';
let panelId = 0;

// Only folding is a preference now; old floating positions are ignored.
// The host's sidebar layout keeps these controls outside the model viewport.
export function mountViewerToolsPanel(host, content, { title, language }) {
  const doc = host.ownerDocument;
  const win = doc.defaultView;
  const ja = language === 'ja';
  let collapsed = false;
  try {
    collapsed = JSON.parse(win.localStorage.getItem(STORAGE_KEY))?.collapsed === true;
  } catch { /* Folding remains usable when browser storage is unavailable. */ }

  const panel = doc.createElement('div');
  panel.className = 'viewer-tools-panel';
  const header = doc.createElement('div');
  header.className = 'viewer-tools-header';
  const heading = doc.createElement('h2');
  heading.className = 'viewer-tools-title';
  heading.textContent = title;
  const toggle = doc.createElement('button');
  toggle.type = 'button';
  toggle.className = 'viewer-tools-toggle';
  content.id = `${host.id || `viewer-tools-${++panelId}`}-content`;
  toggle.setAttribute('aria-controls', content.id);
  header.append(heading, toggle);
  content.classList.add('viewer-tools-content');
  panel.append(header, content);
  host.append(panel);

  const updateCollapsed = () => {
    content.hidden = collapsed;
    toggle.textContent = collapsed ? '+' : '−';
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.title = collapsed
      ? (ja ? '3D表示・出力を展開' : 'Expand 3D view and export')
      : (ja ? '3D表示・出力を折りたたむ' : 'Collapse 3D view and export');
    toggle.setAttribute('aria-label', toggle.title);
  };
  const onToggle = () => {
    collapsed = !collapsed;
    updateCollapsed();
    try { win.localStorage.setItem(STORAGE_KEY, JSON.stringify({ collapsed })); } catch { /* Optional preference. */ }
  };
  toggle.addEventListener('click', onToggle);
  updateCollapsed();
  return { dispose() {
    toggle.removeEventListener('click', onToggle);
    panel.remove();
  } };
}
