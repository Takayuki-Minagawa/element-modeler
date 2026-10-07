import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { AppState } from '../js/state.js';
import { FrameScheduler } from '../js/render/frame-scheduler.js';

register('./helpers/three-loader.mjs', import.meta.url);
let THREE, Viewer3D, createExportScene, exportViewerGLB, GLTFLoader, OrbitControls;
let missing = false;
try {
  THREE = await import('three');
  ({ Viewer3D } = await import('../js/viewer3d.js'));
  ({ createExportScene, exportViewerGLB } = await import('../js/render/glb-export.js'));
  ({ GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js'));
  ({ OrbitControls } = await import('three/addons/controls/OrbitControls.js'));
} catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND' || !error.message.includes("'three'")) throw error;
  missing = true;
}

function fixture() {
  const state = new AppState();
  state.settings.showLoads = true;
  state.settings.showSupports = true;
  const a = state.addNode(0, 0), b = state.addNode(4000, 0);
  const c = state.addNode(0, 2000), d = state.addNode(4000, 2000);
  const m1 = state.addMember(a.id, b.id), m2 = state.addMember(c.id, d.id);
  const pending = new Map(); let counter = 0;
  const viewer = new Viewer3D({ hidden: false }, state);
  viewer._frames = new FrameScheduler(() => viewer.animate(), {
    request: cb => { pending.set(++counter, cb); return counter; },
    cancel: id => pending.delete(id),
  });
  viewer._initialized = true;
  viewer.scene = new THREE.Scene();
  viewer.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  viewer.camera.position.set(5, 4, 5);
  viewer.renderer = { clippingPlanes: [], render() {}, dispose() {}, domElement: {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    addEventListener() {}, removeEventListener() {}, remove() {}, getRootNode() { return this; },
    setPointerCapture() {}, releasePointerCapture() {}, style: {}, clientWidth: 100, clientHeight: 100,
  } };
  viewer.controls = new OrbitControls(viewer.camera, viewer.renderer.domElement);
  viewer._onControlsChange = () => viewer.requestRender();
  for (const kind of ['member', 'surface', 'node', 'load', 'support']) {
    viewer[`${kind}Group`] = new THREE.Group(); viewer.scene.add(viewer[`${kind}Group`]);
  }
  viewer._raycaster = new THREE.Raycaster();
  viewer._syncScene();
  return { state, viewer, m1, m2, pending, flush() {
    const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(cb => cb());
  } };
}

// GLTFExporter uses FileReader in browsers; this adapter reads real Blob bytes.
class BlobReader {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.(); }); }
  readAsDataURL(blob) { blob.arrayBuffer().then(result => {
    this.result = `data:${blob.type};base64,${Buffer.from(result).toString('base64')}`; this.onloadend?.();
  }); }
}

test('Three 0.170 renderer behavior and binary GLB round trip', { skip: missing && 'Install three@0.170.0 or set THREE_TEST_ROOT (see js/render/INTEGRATION.md)' }, async t => {
  assert.equal(THREE.REVISION, '170');
  await t.test('selection reuses geometry and shared base colors; edits rebuild after selection', () => {
    const { state, viewer, m1, m2, flush } = fixture();
    const first = viewer._visuals.get(`member:${m1.id}`)[0];
    const second = viewer._visuals.get(`member:${m2.id}`)[0];
    assert.equal(first.material, second.material);
    const geometry = first.geometry, base = second.material;
    state.select('member', m1.id);
    for (let i = 0; i < 100; i++) viewer.requestRebuild();
    flush();
    assert.equal(viewer.stats.rebuilds, 1);
    assert.equal(first.geometry, geometry);
    assert.notEqual(first.material, second.material);
    assert.equal(first.material.color.getHexString(), 'f38ba8');
    assert.equal(second.material, base);
    state.clearSelection(); viewer.requestSelectionUpdate(); flush();
    assert.equal(first.material, base);
    state.updateNode(state.nodes[1].id, { x: 6000, y: 0 });
    viewer.requestSelectionUpdate(); flush();
    assert.equal(viewer.stats.rebuilds, 2);
    assert.notEqual(viewer._visuals.get(`member:${m1.id}`)[0].geometry, geometry);
    assert.equal(viewer._visuals.get(`member:${m1.id}`)[0].geometry.parameters.width, 6);
    viewer.dispose();
  });

  await t.test('black member lines highlight while outline colors remain unchanged', () => {
    const { state, viewer, m1 } = fixture();
    state.settings.member3dRenderMode = 'line';
    m1.color = '#000000';
    viewer.requestRebuild({ force: true }); viewer._syncScene();
    const object = viewer._visuals.get(`member:${m1.id}`)[0];
    assert.equal(object.material.color.getHexString(), '000000');
    state.select('member', m1.id); viewer.updateSelection();
    assert.equal(object.material.color.getHexString(), 'f38ba8');
    viewer.dispose();
  });

  await t.test('hidden views queue no RAF, retain model changes and stop after a static frame', () => {
    const { viewer, state, pending, flush } = fixture();
    viewer.requestRender(); flush(); assert.equal(pending.size, 0);
    viewer.setActive(false);
    state.addNode(9000, 9000); viewer.requestRebuild();
    assert.equal(pending.size, 0);
    viewer._frames.setActive(true); flush();
    assert.equal(viewer.stats.rebuilds, 2);
    assert.equal(pending.size, 0);
    viewer.requestRender(); viewer.dispose();
    assert.equal(pending.size, 0); flush();
  });

  await t.test('clipping and isolation reject hidden ray hits, preserve state and survive rebuilds', () => {
    const { state, viewer, m1, m2 } = fixture();
    const first = viewer._visuals.get(`member:${m1.id}`)[0];
    const second = viewer._visuals.get(`member:${m2.id}`)[0];
    const revision = state.revision;
    const hits = [
      { object: first, point: new THREE.Vector3(3, 0, 0) },
      { object: second, point: new THREE.Vector3(1, 0, -2) },
    ];
    viewer._raycaster.intersectObjects = () => hits;
    let picked;
    viewer.onPick = pick => { picked = pick; };
    viewer.setClipping('X', 2000);
    viewer._pickAt(50, 50); assert.equal(picked.id, m2.id);
    assert.equal(viewer.stats.rebuilds, 1);
    viewer.clearClipping();
    state.select('member', m2.id);
    assert.equal(viewer.isolateSelection(), true);
    assert.equal(first.visible, false); assert.equal(second.visible, true);
    viewer._pickAt(50, 50); assert.equal(picked.id, m2.id);
    state.select('member', m1.id); viewer.updateSelection();
    assert.equal(first.visible, false); // isolation is a snapshot
    assert.equal(viewer.focusSelection(), false);
    viewer.requestRebuild({ force: true }); viewer._syncScene();
    assert.equal(viewer._visuals.get(`member:${m1.id}`)[0].visible, false);
    viewer.clearIsolation();
    assert.equal(viewer._visuals.get(`member:${m1.id}`)[0].visible, true);
    assert.equal(state.revision, revision);
    viewer.dispose();
  });

  await t.test('real raycaster skips a clipped front member and selects the visible member behind', () => {
    const { viewer, state, m1, m2 } = fixture();
    viewer.camera.position.set(2, 0.1, 10);
    viewer.controls.target.set(2, 0.1, 0);
    viewer.camera.lookAt(viewer.controls.target);
    viewer.setClipping('Y', 1000, true); // remove first beam; retain CAD y >= 1000mm
    let picked = null; viewer.onPick = hit => { picked = hit; };
    viewer._pickAt(50, 50);
    assert.equal(picked.id, m2.id);
    viewer.clearClipping(); viewer._pickAt(50, 50);
    assert.equal(picked.id, m1.id);
    assert.equal(state.selectedMemberId, null);
    viewer.dispose();
  });

  await t.test('focus fits selection in portrait view and clipped bounds', () => {
    const { state, viewer, m2 } = fixture();
    state.select('member', m2.id); viewer.camera.aspect = 0.25;
    viewer.setClipping('X', 2000);
    assert.equal(viewer.focusSelection(), true);
    assert.ok(Math.abs(viewer.controls.target.x - 1) < 1e-6);
    assert.equal(viewer.controls.target.z, -2);
    assert.ok(viewer.camera.position.distanceTo(viewer.controls.target) > 9);
    viewer.setClipping('X', -1000);
    assert.equal(viewer.focusSelection(), false);
    viewer.dispose();
  });

  await t.test('initial and whole-model fit cover every corner in a narrow viewport and preserve direction', () => {
    const { state, viewer } = fixture();
    state.updateNode(state.nodes[1].id, { x: 300000, y: 0 });
    viewer.camera.aspect = 0.18;
    viewer.resetModelView(); viewer._syncScene();
    const assertFramed = () => {
      const { box } = viewer._computeContentBounds({ clipped: true });
      viewer.camera.updateMatrixWorld(true);
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          const point = new THREE.Vector3(x, y, z).project(viewer.camera);
          assert.ok(Math.abs(point.x) < 1 && Math.abs(point.y) < 1 && Math.abs(point.z) < 1,
            `model corner outside camera: ${point.toArray()}`);
        }
      }
    };
    assertFramed();
    viewer.camera.position.copy(viewer.controls.target).add(new THREE.Vector3(-3, 1, -4));
    const direction = viewer.camera.position.clone().sub(viewer.controls.target).normalize();
    assert.equal(viewer.focusAll(), true);
    assert.ok(direction.distanceTo(viewer.camera.position.clone().sub(viewer.controls.target).normalize()) < 1e-12);
    assertFramed();
    viewer.dispose();
  });

  await t.test('view presets use CAD axes with a stable orbit up direction', () => {
    const { viewer } = fixture();
    viewer.camera.aspect = 0.3;
    for (const [name, expected, right, up] of [
      ['oblique', [1, 0.8, 1], null, null],
      ['top', [0, 1, 0], [1, 0, 0], [0, 0, -1]],
      ['front', [0, 0, 1], [1, 0, 0], [0, 1, 0]],
      ['right', [1, 0, 0], [0, 0, -1], [0, 1, 0]],
    ]) {
      assert.equal(viewer.setViewPreset(name), true);
      const direction = viewer.camera.position.clone().sub(viewer.controls.target).normalize();
      assert.ok(direction.distanceTo(new THREE.Vector3(...expected).normalize()) < 2e-6, name);
      assert.deepEqual(viewer.camera.up.toArray(), [0, 1, 0]);
      viewer.camera.updateMatrixWorld(true);
      if (right) {
        const center = viewer.controls.target.clone().project(viewer.camera);
        const rightPoint = viewer.controls.target.clone().add(new THREE.Vector3(...right)).project(viewer.camera);
        const upPoint = viewer.controls.target.clone().add(new THREE.Vector3(...up)).project(viewer.camera);
        assert.ok(rightPoint.x > center.x, `${name} right direction`);
        assert.ok(upPoint.y > center.y, `${name} up direction`);
      }
      const position = viewer.camera.position.clone();
      viewer.controls.update();
      assert.ok(position.distanceTo(viewer.camera.position) < 1e-8, `${name} settled camera`);
    }
    assert.equal(viewer.setViewPreset('unknown'), false);
    viewer.dispose();
  });

  await t.test('whole-model fit respects clipping, isolation and filters without changing the model', () => {
    const { state, viewer, m2 } = fixture();
    const farA = state.addNode(5000, 1000000), farB = state.addNode(6000, 1000000);
    state.addMember(farA.id, farB.id);
    viewer.requestRebuild(); viewer._syncScene();
    const range = viewer.getClippingRange('Y');
    viewer.setClipping('X', 2000);
    assert.equal(viewer.focusAll(), true);
    assert.ok(Math.abs(viewer.controls.target.x - 1) < 1e-6);
    assert.equal(viewer.controls.target.z, -1); // fully clipped far member is excluded
    state.select('member', m2.id); viewer.isolateSelection();
    const model = state.toJSON();
    assert.equal(viewer.focusAll(), true);
    assert.equal(viewer.controls.target.z, -2);
    assert.deepEqual(viewer.getClippingRange('Y'), range); // slider remains independent of isolation
    assert.deepEqual(state.toJSON(), model);
    assert.deepEqual([...viewer._isolation], [`member:${m2.id}`]);
    assert.deepEqual(viewer.clipping, { axis: 'X', positionMm: 2000, flipped: false });
    const position = viewer.camera.position.clone(), target = viewer.controls.target.clone();
    viewer.setClipping('X', -1000);
    assert.equal(viewer.focusAll(), false);
    assert.equal(viewer.setViewPreset('top'), false);
    assert.deepEqual(viewer.camera.position, position);
    assert.deepEqual(viewer.controls.target, target);
    viewer.clearClipping(); viewer.clearIsolation();
    state.settings.showMembers = false;
    viewer.requestRebuild(); viewer._syncScene();
    assert.equal(viewer.focusAll(), false);
    assert.deepEqual(viewer.camera.position, position);
    viewer.dispose();
  });

  await t.test('whole-model fit excludes helpers and standalone node visuals', () => {
    const { viewer } = fixture();
    assert.equal(viewer.focusAll(), true);
    const position = viewer.camera.position.clone(), target = viewer.controls.target.clone();
    const node = new THREE.Mesh(new THREE.SphereGeometry(), new THREE.MeshBasicMaterial());
    node.position.set(100000, 100000, 100000);
    viewer.nodeGroup.add(node); viewer._visuals.set('node:orphan', [node]);
    viewer.gridHelper = new THREE.GridHelper(1000000, 2); viewer.scene.add(viewer.gridHelper);
    assert.equal(viewer.focusAll(), true);
    assert.ok(viewer.camera.position.distanceTo(position) < 1e-10);
    assert.deepEqual(viewer.controls.target, target);
    viewer._isolation = new Set(['node:orphan']); viewer._applyIsolation();
    assert.equal(viewer.focusAll(), false);
    viewer.dispose();
    node.material.dispose();
  });

  await t.test('picking accepts single clicks and taps but excludes navigation and interrupted gestures', () => {
    const { viewer } = fixture();
    const picks = [];
    viewer._pickAt = (x, y) => picks.push([x, y]);
    const pointer = (patch = {}) => ({ pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1,
      isPrimary: true, clientX: 50, clientY: 50, ...patch });
    const start = patch => viewer._beginPickGesture(pointer(patch));
    const move = patch => viewer._movePickGesture(pointer(patch));
    const end = patch => viewer._endPickGesture(pointer({ buttons: 0, ...patch }));
    start(); end();
    start({ pointerType: 'touch' }); end({ pointerType: 'touch', clientX: 52 });
    assert.deepEqual(picks, [[50, 50], [52, 50]]);
    for (const modifier of ['ctrlKey', 'shiftKey', 'metaKey', 'altKey']) {
      start({ [modifier]: true }); end();
      start(); end({ [modifier]: true });
    }
    start({ button: 2, buttons: 2 }); end({ button: 2 });
    start(); move({ clientX: 54 }); move({ clientX: 50 }); end(); // round trip exceeds total travel
    start(); move({ buttons: 3 }); end();
    start(); start({ pointerId: 2, pointerType: 'touch', isPrimary: false });
    end({ pointerId: 2 }); end();
    start(); viewer._cancelPickGesture(pointer()); end();
    start(); end({ pointerId: 99 }); move({ clientX: 60 }); end();
    assert.equal(picks.length, 2);
    assert.equal(viewer._pickPointers.size, 0);
    start({ pointerType: 'touch' }); end({ pointerType: 'touch' });
    assert.equal(picks.length, 3); // a new gesture after multitouch/cancel still works
    viewer.dispose();
  });

  await t.test('interrupted pointer capture resets orbit tracking and allows the next click and pan', async () => {
    const { viewer } = fixture();
    const event = { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1,
      isPrimary: true, clientX: 50, clientY: 50 };
    viewer.controls.target.set(200, 300, 400);
    viewer.camera.position.copy(viewer.controls.target).add(new THREE.Vector3(5, 4, 5));
    viewer.controls.update();
    const target = viewer.controls.target.clone(), position = viewer.camera.position.clone();
    const oldControls = viewer.controls;
    viewer._beginPickGesture(event); oldControls._onPointerDown(event);
    assert.deepEqual(oldControls._pointers, [1]);
    viewer._cancelPointerInteraction(); // blur, hidden document or hidden viewer
    assert.notEqual(viewer.controls, oldControls);
    assert.deepEqual(viewer.controls._pointers, []);
    assert.deepEqual(viewer.controls.target, target);
    assert.ok(viewer.camera.position.distanceTo(position) < 1e-10);
    assert.deepEqual(viewer.camera.up.toArray(), [0, 1, 0]);
    assert.equal(viewer.controls.enablePan, true);
    assert.equal(viewer.controls.zoomToCursor, true);
    assert.equal(viewer.controls.enableDamping, true);
    assert.ok(viewer.controls.hasEventListener('change', viewer._onControlsChange));
    let picks = 0; viewer._pickAt = () => picks++;
    viewer._beginPickGesture(event); viewer.controls._onPointerDown(event);
    const restoredControls = viewer.controls;
    viewer._lostPickPointerCapture(event); // even a release before our up listener is harmless
    viewer._endPickGesture({ ...event, buttons: 0 }); viewer.controls._onPointerUp(event);
    await Promise.resolve();
    assert.equal(picks, 1);
    assert.equal(viewer.controls, restoredControls);
    const pan = { ...event, button: 2, buttons: 2 };
    viewer._beginPickGesture(pan); viewer.controls._onPointerDown(pan);
    viewer.controls._onPointerMove({ ...pan, clientX: 60 });
    assert.ok(viewer.controls.target.distanceTo(target) > 0);
    assert.ok(viewer.controls.target.distanceTo(target) < 2);
    viewer._endPickGesture({ ...pan, clientX: 60, buttons: 0 }); viewer.controls._onPointerUp(pan);
    assert.equal(picks, 1);
    viewer._beginPickGesture(event); viewer.controls._onPointerDown(event);
    viewer._lostPickPointerCapture(event);
    await Promise.resolve();
    assert.equal(viewer._pickPointers.size, 0);
    assert.deepEqual(viewer.controls._pointers, []);
    viewer._beginPickGesture(event); viewer.controls._onPointerDown(event);
    viewer.stopRendering();
    assert.equal(viewer._pickPointers.size, 0);
    assert.deepEqual(viewer.controls._pointers, []);
    viewer.dispose();
  });

  await t.test('nested/shared resources disposed once, cache evicted after color changes', () => {
    const { state, viewer, m1 } = fixture();
    let geometries = 0, materials = 0;
    const geometry = new THREE.BoxGeometry(); geometry.addEventListener('dispose', () => geometries++);
    const material = new THREE.MeshBasicMaterial(); material.addEventListener('dispose', () => materials++);
    const helper = new THREE.Group();
    const nested = new THREE.Group(); helper.add(nested);
    nested.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
    viewer.originAxes = helper; viewer.scene.add(helper);
    for (let i = 0; i < 12; i++) {
      m1.color = `#${(i + 10).toString(16).repeat(3)}`;
      state._touch(); viewer.requestRebuild(); viewer._syncScene();
    }
    assert.ok(viewer._matCache.size < 8);
    viewer.dispose(); viewer.dispose();
    assert.equal(geometries, 1); assert.equal(materials, 1);
    assert.equal(viewer.scene.children.length, 0);
  });

  await t.test('GLB preserves dimensions, source IDs and colors; clipping/isolation baked without mutating scene', async () => {
    globalThis.FileReader = BlobReader;
    globalThis.ProgressEvent ??= class { constructor(type, values) { this.type = type; Object.assign(this, values); } };
    const { state, viewer, m2 } = fixture();
    state.select('member', m2.id); viewer.isolateSelection(); viewer.setClipping('X', 2000);
    viewer.updateSelection();
    const original = viewer._visuals.get(`member:${m2.id}`)[0];
    const positions = original.geometry.getAttribute('position').array.slice();
    const geometry = original.geometry, material = original.material;
    const snapshot = createExportScene(viewer);
    assert.ok(snapshot.children.length > 0);
    assert.ok(snapshot.children.every(o => o.userData.element.id === m2.id));
    assert.equal(snapshot.children[0].material.color.getHexString(), viewer._baseMaterials.get(original).color.getHexString());
    for (const child of snapshot.children) { child.geometry.dispose(); child.material.dispose(); }
    const binary = await exportViewerGLB(viewer);
    assert.ok(binary instanceof ArrayBuffer);
    const header = new DataView(binary);
    assert.equal(header.getUint32(0, true), 0x46546c67);
    assert.equal(header.getUint32(4, true), 2);
    assert.equal(header.getUint32(8, true), binary.byteLength);
    const jsonSize = header.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(binary, 20, jsonSize)));
    assert.equal(json.scenes[0].extras.units, 'm');
    assert.ok(json.nodes.some(node => node.extras?.element?.id === m2.id));
    const loaded = await new GLTFLoader().parseAsync(binary, '');
    const box = new THREE.Box3().setFromObject(loaded.scene);
    assert.ok(Math.abs(box.min.x) < 1e-5);
    assert.ok(Math.abs(box.max.x - 2) < 1e-5);
    assert.ok(box.min.z < -2 && box.max.z > -2);
    assert.equal(original.geometry, geometry); assert.equal(original.material, material);
    assert.deepEqual(original.geometry.getAttribute('position').array, positions);
    viewer.dispose();
  });

  await t.test('export clipping retains only the chosen half-space for all axes and flips', () => {
    const { state, viewer, m2 } = fixture();
    state.select('member', m2.id); viewer.isolateSelection();
    for (const [axis, cut] of [['X', 2000], ['Y', 2000], ['Z', 200]]) for (const flipped of [false, true]) {
      viewer.setClipping(axis, cut, flipped);
      const snapshot = createExportScene(viewer);
      snapshot.updateMatrixWorld(true);
      assert.ok(snapshot.children.length > 0);
      for (const child of snapshot.children) {
        const positions = child.geometry.getAttribute('position');
        for (let i = 0; i < positions.count; i++) {
          const point = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(child.matrixWorld);
          assert.ok(viewer._clipPlane.distanceToPoint(point) >= -1e-6);
        }
        child.geometry.dispose(); child.material.dispose();
      }
    }
    viewer.dispose();
  });

  await t.test('failed GLB export disposes snapshot resources and preserves live geometry', async () => {
    const { viewer } = fixture();
    let liveDisposals = 0, copyDisposals = 0, count = 0;
    viewer.memberGroup.children[0].geometry.addEventListener('dispose', () => liveDisposals++);
    const exporter = { async parseAsync(snapshot) {
      for (const child of snapshot.children) {
        count += 2;
        child.geometry.addEventListener('dispose', () => copyDisposals++);
        child.material.addEventListener('dispose', () => copyDisposals++);
      }
      throw new Error('Export failure');
    } };
    await assert.rejects(exportViewerGLB(viewer, exporter), /Export failure/);
    assert.equal(copyDisposals, count);
    assert.equal(liveDisposals, 0);
    viewer.dispose();
  });

  await t.test('polygon floor plan Y maps to scene -Z', () => {
    const { state, viewer } = fixture();
    const surface = state.addSurfacePolygon([{ x: 1000, y: 2000 }, { x: 3000, y: 2000 }, { x: 3000, y: 4000 }], { type: 'floor' });
    viewer.requestRebuild(); viewer._syncScene();
    const object = viewer._visuals.get(`surface:${surface.id}`)[0];
    const box = new THREE.Box3().setFromObject(object);
    assert.ok(Math.abs(box.min.z + 4) < 1e-6);
    assert.ok(Math.abs(box.max.z + 2) < 1e-6);
    viewer.dispose();
  });
});
