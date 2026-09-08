/** Keep CAD shortcuts out of text editing, IME composition and modal forms. */
export function blocksCadShortcut(event) {
  const target = event.target;
  return Boolean(event.defaultPrevented || event.isComposing ||
    ['INPUT', 'SELECT', 'TEXTAREA'].includes(target?.tagName) || target?.isContentEditable ||
    target?.closest?.('dialog, .modal-overlay.visible') ||
    (typeof document !== 'undefined' && document.querySelector?.('dialog[open], .modal-overlay.visible')));
}
export function toolForKey(event) {
  if (event.ctrlKey || event.metaKey || event.altKey || blocksCadShortcut(event)) return null;
  return { v: 'select', m: 'member', f: 'surface', l: 'load', s: 'support', d: 'measure' }[event.key?.toLowerCase()] || null;
}
