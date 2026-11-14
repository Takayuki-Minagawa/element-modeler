// Member selection commands (select all / invert / connected) shared by the
// edit menu and keyboard shortcuts. Pure functions: callers pass the member
// list, a selectability predicate and an endpoint resolver, so the rules can
// be tested without the DOM or the state object.

function selectableMembers(members, isSelectable) {
  return (Array.isArray(members) ? members : []).filter(member => member && isSelectable(member));
}

export function allSelectableMemberIds(members, isSelectable) {
  return selectableMembers(members, isSelectable).map(member => member.id);
}

export function invertedMemberIds(members, selectedIds, isSelectable) {
  const selected = new Set(selectedIds || []);
  return selectableMembers(members, isSelectable)
    .filter(member => !selected.has(member.id))
    .map(member => member.id);
}

// endpointKeys(member) returns every connection key of one member (callers
// decide what makes two ends the same point). Walking is
// limited to selectable members, so hidden or locked members neither join the
// result nor bridge two otherwise separate groups.
export function connectedMemberIds(members, seedIds, { isSelectable, endpointKeys }) {
  const candidates = selectableMembers(members, isSelectable);
  const byId = new Map(candidates.map(member => [member.id, member]));
  const keysById = new Map();
  const membersByKey = new Map();
  for (const member of candidates) {
    const keys = [...new Set(endpointKeys(member) || [])];
    keysById.set(member.id, keys);
    for (const key of keys) {
      if (!membersByKey.has(key)) membersByKey.set(key, []);
      membersByKey.get(key).push(member.id);
    }
  }

  const visited = new Set();
  const queue = [];
  for (const id of seedIds || []) {
    if (!byId.has(id) || visited.has(id)) continue;
    visited.add(id);
    queue.push(id);
  }
  for (let head = 0; head < queue.length; head++) {
    for (const key of keysById.get(queue[head])) {
      for (const nextId of membersByKey.get(key)) {
        if (visited.has(nextId)) continue;
        visited.add(nextId);
        queue.push(nextId);
      }
    }
  }
  // Preserve model order for a stable selection.
  return candidates.filter(member => visited.has(member.id)).map(member => member.id);
}
