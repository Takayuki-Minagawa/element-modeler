# Renderer architecture and API contracts

Application bootstrap coordinates model notifications, active views and UI
lifecycle. The renderers own frame scheduling, display indexes and drawing
resources; they do not patch AppState or change model revision.

```js
import { mountViewerTools } from './render/viewer-tools.js';

// Model and display notifications schedule at most one frame per view.
canvas2d.requestDraw();
viewer3d?.requestRebuild();

// After updating canvas/container.hidden during a tab switch:
canvas2d.setActive(activeView === '2d');
viewer3d?.setActive(activeView === '3d');

// startRendering() also lazily initializes and activates the viewer.
viewer3d.startRendering();
const viewerTools = mountViewerTools(hostElement, viewer3d, {
  language: 'ja', // or 'en'; dispose/remount when switching languages
  onError: error => showNotice(error.message, 'error'),
});
// Refresh slider bounds following model/import/undo changes.
viewerTools.refresh();

// Synchronous PNG export, including when the 2D view is hidden/inactive:
canvas2d.draw({ force: true });
const png = canvasElement.toDataURL('image/png');

// Teardown:
viewerTools.dispose();
canvas2d.dispose();
viewer3d.dispose();
```

`requestRebuild()` compares model revision, model-array identity/length and a
small display stamp (settings, active level, level properties). Selection-only
updates swap cached materials without rebuilding geometry. For a known selection
change use `requestSelectionUpdate()`. It still detects concurrent model changes.
`requestDisplayUpdate()` handles display settings. Changes to layer filters,
render modes and section display rebuild because floor rest heights and visible
geometry depend on them. Clipping and isolation update rendering/visibility only.
When legacy code mutates geometry in place without advancing revision, call
`requestRebuild({ force: true })`. Normal public state mutation methods need no
special handling.

`requestRender()` schedules a view frame; queued model and selection changes
are resolved before the GPU draw. OrbitControls change events keep
damping alive until it settles. `setActive(false)` cancels pending RAF and keeps
dirty state; activation schedules a fresh frame. Hidden views do not poll.
Call `canvas2d.requestDraw()` after theme changes, external camera changes and
asynchronous content arrival. Pan, zoom, ResizeObserver, preview/measure/marquee
assignment, mouse/pointer movement, and keyboard input already invalidate 2D.
Mutable preview/measure fields are read at draw time, after tool handlers run.
`draw()` is synchronous and skips inactive, hidden or unchanged views.
`draw({ force: true })` synchronously rebuilds the render index and draws the
current model, selection and overlays into the existing canvas bitmap, bypassing
those guards. Use it immediately before PNG serialization. It preserves the
active/hidden state and schedules no RAF. It uses the current camera and bitmap
size, does not resize a hidden view, and remains a no-op after disposal.

Browser tests inspect the application through `window._app`, including state,
canvas2d and the lazily initialized viewer3d getter. `canvas2d.stats.frames` and
`viewer3d.stats.{frames,rebuilds,selectionUpdates}` are cumulative diagnostics.

## Inspection and export APIs

- `setClipping('X' | 'Y' | 'Z', positionMm, flipped = false)`: retain CAD
  coordinate <= position; flip retains >=. `clearClipping()` removes the plane.
- `getClippingRange(axis)`: bounds in CAD millimeters for the model that passes
  layer filters (independent of isolation); returns `{min,max}`.
- `isolateSelection()`: snapshot of selected displayed elements; returns false
  for no displayed selection. Later selection changes do not replace it.
  `clearIsolation()` restores elements allowed by normal layer filters.
- `focusSelection()` / `focusElements([{kind,id}, ...])`: frame the visible,
  retained portion, preserving camera direction; false if none can be framed.
  Hidden levels are not implicitly enabled. Diagnostics can use this API to
  focus referenced elements.
- `focusAll()`: frame all displayed model elements with the current direction,
  respecting clipping and isolation. Grid, axes and node markers do not expand
  the bounds. Returns false without moving the camera if nothing is visible.
- `setViewPreset('oblique' | 'top' | 'front' | 'right')`: frame displayed elements
  from a standard CAD direction, preserving perspective projection and all
  visibility settings. Top has plan X right / Y up; front has X right / Z up.
- `exportGLB()`: Promise of an ArrayBuffer; binary GLB with display geometry,
  element ID/kind/type/level/section extras, and original colors. The temporary
  snapshot is independently owned and disposed on both success and failure.

Exports respect layer filters, isolation and the clipping plane. Cut faces are
open, as in the viewer. Grid, origin axes, cameras and lights are omitted. Nodes,
supports, loads, member lines and outlines are exported when displayed. This is
a display model, not an analysis exchange format. Scene units are meters, Y-up:
CAD `(x,y,z)` millimeters becomes `(x,z,-y)/1000`. Both the core and addon import
map must stay pinned to **Three.js 0.170.0**. GLTFExporter is loaded on demand.

## Validation

Use the exact `three: "0.170.0"` dev dependency, or run with
`THREE_TEST_ROOT=/absolute/path/to/node_modules/three` for an isolated install:

```sh
node --test test/render-*.test.js
node test/render-benchmark.mjs --run
npx eslint js/viewer3d.js js/canvas2d.js js/render
```

The real-Three tests verify selection identity/colors, clipping-aware Raycaster
picks, hidden-frame cancellation, clipped camera focus, cache eviction, nested
resource disposal and actual binary GLB export/reload. The CPU benchmark compares
the renderer at fixed commit `2062b2ccba0366ba8efc56991b7ea91cf00960e9` with
current renderer methods using identical fixtures and the current shared domain
API. Use `--baseline <commit-or-ref>` to override; the JSON report records the
requested ref and resolved commit. It includes index construction in lookup
timing; GPU rendering and frame-rate are outside that benchmark. See the adjacent
[BENCHMARK.md](BENCHMARK.md) for the captured results and limitations.
[README](../../README.md) documents user workflows; this document defines the
renderer contracts used by application code.

Fixed-version references checked during implementation:
[OrbitControls r170](https://github.com/mrdoob/three.js/blob/r170/examples/jsm/controls/OrbitControls.js),
[GLTFExporter r170](https://github.com/mrdoob/three.js/blob/r170/examples/jsm/exporters/GLTFExporter.js),
[BufferAttribute r170](https://github.com/mrdoob/three.js/blob/r170/src/core/BufferAttribute.js).
