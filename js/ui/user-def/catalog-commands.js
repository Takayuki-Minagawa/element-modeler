import { importUserDefs } from '../../io.js';
import { hasProvisionalEdit } from '../../domain/provisional-edit.js';

// Catalog edits can also propagate section properties to placed elements.
const CONTENT_FIELDS = ['materialCatalog', 'springCatalog', 'sectionCatalog', 'members', 'surfaces'];

function detachedState(state) {
  return Object.assign(Object.create(Object.getPrototypeOf(state)), structuredClone({ ...state }));
}

function changedFields(before, after) {
  return CONTENT_FIELDS.filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}

// Validate with the state's own normalization/reference rules on detached data.
// Only prepared, meaningful changes reach history. This also avoids revision
// bumps, reference replacement and lost redo for normalized no-op updates.
export function createCatalogCommands({ state, history = null }) {
  function commit(staged, result) {
    const fields = changedFields(state, staged);
    if (!fields.length) return undefined;
    // A file read can finish after the catalog dialog closes and a drag
    // starts. Never retain those temporary coordinates in catalog Undo.
    if (hasProvisionalEdit(state)) {
      throw new Error('Finish or cancel the current edit before changing user definitions');
    }
    const apply = () => {
      for (const key of fields) state[key] = staged[key];
      state.revision = staged.revision;
      return result;
    };
    return history ? history.transact(apply) : apply();
  }

  function execute(method, args) {
    const staged = detachedState(state);
    let result;
    try {
      result = staged[method](...args);
    } catch {
      return null;
    }
    if (!result) return null;
    return commit(staged, result);
  }

  const commands = Object.fromEntries([
    'addSection', 'updateSection', 'removeSection',
    'addSpring', 'updateSpring', 'removeSpring',
    'addMaterial', 'updateMaterial', 'removeMaterial',
  ].map(method => [method, (...args) => execute(method, args)]));

  commands.importFile = async file => {
    // Let IO decode the file into a command batch, without modifying live state
    // or capturing a stale snapshot while FileReader is pending. Material
    // add/override decisions and validation happen against the latest state.
    const entries = [];
    const enqueue = (kind, entry) => { entries.push({ kind, entry }); return true; };
    await importUserDefs(file, {
      getMaterial: () => null,
      addMaterial: entry => enqueue('Material', entry),
      addSpring: entry => enqueue('Spring', entry),
      addSection: entry => enqueue('Section', entry),
    });
    const staged = detachedState(state);
    const summary = { added: 0, skipped: 0 };
    for (const { kind, entry } of entries) {
      const before = CONTENT_FIELDS.map(key => JSON.stringify(staged[key]));
      const result = kind === 'Material' && staged.getMaterial(entry.name)?.isDefault
        ? staged.updateMaterial(entry.name, entry)
        : staged[`add${kind}`](entry);
      const changed = result && CONTENT_FIELDS.some((key, index) => before[index] !== JSON.stringify(staged[key]));
      if (changed) summary.added++;
      else summary.skipped++;
    }
    if (summary.added) commit(staged, summary);
    return summary;
  };
  return commands;
}
