export function showInspector(name, { reveal = false } = {}) {
  const panel = document.getElementById('inspector-' + name);
  if (!panel) return;
  for (const tab of document.querySelectorAll('[data-inspector-tab]')) {
    const active = tab.dataset.inspectorTab === name;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
  }
  if (reveal && document.body.classList.contains('property-collapsed')) {
    document.getElementById('btn-toggle-property').click();
  }
}


export function initInspectorTabs() {
  const tabs = [...document.querySelectorAll('[data-inspector-tab]')];
  for (const tab of tabs) {
    tab.addEventListener('click', () => showInspector(tab.dataset.inspectorTab));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const index = tabs.indexOf(tab);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
      showInspector(tabs[next].dataset.inspectorTab);
      tabs[next].focus();
    });
  }
}
