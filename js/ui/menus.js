// Native form controls retain their default keys inside disclosure menus.
export function initMenus(header, { onOpen } = {}) {
  const triggers = [...header.querySelectorAll('.menu-trigger')];
  let openTrigger = null;
  function closeMenu(restoreFocus = false) {
    if (!openTrigger) return;
    const trigger = openTrigger;
    document.getElementById(trigger.getAttribute('aria-controls')).hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    openTrigger = null;
    if (restoreFocus) trigger.focus();
  }
  function openMenu(trigger) {
    closeMenu();
    onOpen?.();
    const panel = document.getElementById(trigger.getAttribute('aria-controls'));
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    openTrigger = trigger;
    panel.style.left = '0px';
    const rect = panel.getBoundingClientRect();
    panel.style.left = Math.min(0, window.innerWidth - rect.right - 8) + 'px';
  }
  for (const trigger of triggers) {
    trigger.addEventListener('click', () => openTrigger === trigger ? closeMenu() : openMenu(trigger));
  }
  document.addEventListener('pointerdown', event => {
    if (!header.contains(event.target)) closeMenu();
  });
  document.addEventListener('focusin', event => {
    if (!header.contains(event.target)) closeMenu();
  });
  window.addEventListener('resize', () => closeMenu());
  // Close before command handlers run, so a newly opened dialog keeps focus.
  header.addEventListener('click', event => {
    if (event.target.closest('.menu-dropdown button')) closeMenu(true);
  }, true);
  document.addEventListener('keydown', event => {
    if (event.isComposing || !openTrigger && !header.contains(event.target)) return;
    if (event.target.closest('dialog, .modal-overlay')) return;
    if (!openTrigger && !['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Home', 'End', ' ', 'Enter'].includes(event.key)) return;
    if (event.key === 'Escape' && openTrigger) {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
      return;
    }
    // Preserve native editing but keep CAD shortcuts from reaching the model.
    event.stopPropagation();
    if (event.target.matches('input, select, textarea')) return;
    const trigger = event.target.closest('.menu-trigger');
    if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault();
      const index = triggers.indexOf(trigger || openTrigger);
      const next = triggers[(index + (event.key === 'ArrowRight' ? 1 : triggers.length - 1)) % triggers.length];
      if (openTrigger) openMenu(next);
      next.focus();
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (trigger) openMenu(trigger);
      if (!openTrigger) return;
      const panel = document.getElementById(openTrigger.getAttribute('aria-controls'));
      const items = [...panel.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled)')].filter(el => el.getClientRects().length);
      const index = items.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : event.key === 'ArrowUp' ? (index <= 0 ? items.length - 1 : index - 1) : (index + 1) % items.length;
      items[next]?.focus();
    }
  }, true);
  return { close: closeMenu };
}
