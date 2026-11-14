# Phase 1 module and integration contracts

## Model boundaries

- `js/domain/model.js`: shared defaults, type predicates and normalization. No AppState, DOM or rendering imports. Existing helper exports from `state.js` remain aliases of these functions.
- `state.js`: owns model collections, mutating methods, revision and compatibility delegates. The public entry points remain in place.
- `state/catalog.js`: catalog CRUD, lookups, default/member-end resolution, legacy section creation and propagation of definitions to existing elements. It operates on the AppState receiver without importing AppState.
- `state/runtime.js`: selection, runtime reset, and sticky member/surface drafts. These operations never bump the model revision; default-reset behavior and public method names are unchanged.
- `serialization.js`: CAD format remains unchanged; this extraction changes only its helper import path. CAD omits unused section/spring definitions and load retains current custom definitions.
- `section-catalog.js`: catalog definitions and normalization. State applies section changes to model elements. `ui/user-def/` owns user-definition editing.
- `model-ops.js` / `roof-generation.js`: model operations receive state explicitly and import shared helpers from the domain layer. None of the three modules above imports AppState.
- `domain/id-index.js`: lazily built ID maps with array identity/length and entry-position checks. Public mutations invalidate through `_touch()`. Array replacement, append, splice and direct ID edits fall back to lookup/rebuild as needed. `state.invalidateDerivedCaches()` resets `_idIndexes`; `persistence/snapshot.js` excludes derived caches and invokes this hook on restoration.
- `domain/node-merge.js`: pure nearby-node remap planning with spatial buckets and an exact distance check. Retains the original numeric-ID order and non-transitive greedy merge rule; unsafe grid inputs use the original scan. `model-ops.js` applies the resulting remap and owns the model revision update.
- `domain/member-selection.js`: pure select-all, invert and connected-member rules. Callers pass the member list, the selectability predicate and endpoint keys. `tools/selection.js` builds the keys with the analysis export's `createNodePool` (3D positions merged within `NODE_MERGE_TOLERANCE`; end Z from `resolveMemberEndZ`, both cross-brace diagonals), so plan nodes shared by levels do not join floors while distinct node IDs at one point do connect. It applies the IDs through `selectMembers` and cancels an armed split point. The edit-menu buttons are disabled on the 3D tab. Model, revision and history are unchanged.
- `domain/marquee-selection.js`: shared drag-direction and inclusive segment/rectangle predicates. Uses existing member selectability rules without changing model, selection or history. The selection tool applies returned IDs; the canvas uses the same direction rule for the blue solid window and green dashed crossing preview.

Runtime selection, draft settings, previews and camera movement do not belong in CAD files. Exact history snapshots and their restoration are owned by `persistence/snapshot.js` and `History`; this change does not modify AppState's snapshot methods. History retains unused definitions and runtime data separately from CAD serialization.

## Property panels and commands

`UI` delegates member/batch, surface/roof, load and support panels to `ui/properties/`. Delegating methods remain available on `UI.prototype`. Panel rendering is cached by state identity, model revision, selection, active level and language; pointer-only refreshes preserve inputs.

Parent integration:

```js
onModelCommand(mutate) {
  return executeModelCommand(history, state, mutate);
}
onPropertyChange() {
  update();
}
```

`executeModelCommand(history, state, mutate)` returns `{ changed, result }`, compares persisted content including complete catalogs, and enters one `history.transact` boundary. Normalized no-ops preserve revision and both history stacks. History owns exception rollback. Nested panel event helpers share the same command boundary. `onBeforeBigChange` is no longer invoked by the extracted batch panel; the application may retain it for other callers. A panel without the new hook still applies edits via `executeModelMutation`, preserving the previous constructor/public API.

## Tools

`ToolManager` retains event routing, keyboard commands and split-point interaction; `tools/` owns selection, member, surface, load, support and measurement behavior. Completed placement uses the same model command boundary. Preview/draft clicks do not create history.

Dragging temporarily updates node coordinates for the 2D preview without a model revision bump. Release restores original coordinates before committing the final coordinates in one history transaction. Escape, window blur and returning to the original position preserve geometry, revision and Undo/Redo. The application continues requesting 2D draw on pointer events; persistent/3D geometry updates occur on commit. Exterior-wall replacement confirmation and deletion are deferred until the outline is complete.

## Diagnostics

Model checks return `{ severity, code, messageKey, params, elementType, elementId, targets }`. Preflight preserves source error records and associates aggregate issues with CAD member/support/load IDs; analysis element IDs are mapped through `sourceId`. Repeated source IDs (for example X-brace branches) are deduplicated.

`UI.renderModelCheck()` and `UI.renderAnalysisPreflight(report)` share the complete list renderer. Severity/type filters apply to both report types. `setDiagnosticFilters({ severity, elementType })` rerenders and calls optional `onDiagnosticFilterChange(filters)`. Filter state survives report and language changes.

The feature-local Japanese/English dictionary is `ui/diagnostic-messages.js`; no central i18n dictionary edits are required. Messages, IDs and parameters are escaped before HTML rendering. Missing targets are disabled; activation re-resolves the target to avoid stale selection.

Parent integration:

```js
onFocusIssue(issue) {
  // issue.elementType / issue.elementId identify the clicked target.
  // issue.target contains the freshly resolved descriptor below.
  focusIssue(state, canvas2d, issue);
}
```

`resolveDiagnosticTarget(state, ref)` in `domain/diagnostics.js` returns `{ elementType, elementId, levelId, bounds, hidden, requiresLevelChange }`, or null after deletion. Bounds are plan coordinates `{ minX, minY, maxX, maxY }` or null when geometry is unavailable. It never changes state. The application owns level/filter reveal, 2D selection/camera movement and 3D emphasis. The UI explains hidden targets and level changes before activation. `onDiagnosticSelect(target, issue)` remains an optional fallback when `onFocusIssue` is absent.

## Verification

Behavior tests cover roof generation and no-op notices, property edits/presets and batch commands, input-cache invalidation, drag cancellation/commit, delayed exterior-wall replacement, localized full diagnostics/filtering/focus callbacks, preflight CAD references, ID cache restoration and the acyclic dependency graph. The source-location checks broken by extraction have been replaced with event/model assertions.
