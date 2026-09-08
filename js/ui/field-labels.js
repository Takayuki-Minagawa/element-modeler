// Attach visible property labels and coordinate-group names after rendering.
export function associateFieldLabels(root) {
  let index = 0;
  for (const label of root.querySelectorAll?.('.prop-group > label:not([for])') || []) {
    const key = index++;
    const parent = label.parentElement;
    const fields = [...parent.children].filter(child => child.matches('input, select, textarea'));
    if (fields.length === 1) {
      const field = fields[0];
      if (!field.id) field.id = 'property-field-' + key;
      label.htmlFor = field.id;
    }
    if (label.nextElementSibling?.matches('.prop-row, .support-chk-row')) {
      label.id = 'property-label-' + key;
      parent.setAttribute('role', 'group');
      parent.setAttribute('aria-labelledby', label.id);
    }
  }
}
