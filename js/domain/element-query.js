export const ELEMENT_COLLECTIONS = Object.freeze({
  member: 'members', surface: 'surfaces', load: 'loads', support: 'supports',
});

// Query the complete model, including hidden elements. Keep typed references
// so numeric IDs never turn into strings when a table row is selected.
export function queryElements(state, { kind = 'all', levelId = null, search = '',
  memberType = 'all', sectionName = '' } = {}) {
  const query = search.trim().toLowerCase();
  return Object.entries(ELEMENT_COLLECTIONS).flatMap(([elementType, collection]) => {
    if (kind !== 'all' && kind !== elementType) return [];
    return state[collection].filter(item =>
      (levelId === null || item.levelId === levelId) &&
      (kind !== 'member' || memberType === 'all' || item.type === memberType) &&
      (kind !== 'member' || !sectionName || item.sectionName === sectionName) &&
      (!query || String(item.id).toLowerCase().includes(query) ||
        String(item.sectionName || '').toLowerCase().includes(query))
    ).map(item => ({ item, elementType }));
  });
}
