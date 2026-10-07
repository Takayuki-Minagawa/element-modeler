// viewer3d.js - 3D Viewer with three.js

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FrameScheduler } from './render/frame-scheduler.js';
import { RenderIndex, selectedElements, displayStamp } from './render/model-index.js';
import { clippingEquation, isVisibleHit } from './render/clipping.js';
import { disposeObjects } from './render/dispose.js';
import {
  resolveMemberColor,
  resolveSurfaceColor,
  resolveLoadColor,
  SUPPORT_COLOR,
} from './element-style.js';
import { finiteNumber, offsetPolygonOutward } from './geometry-utils.js';
import { MM_TO_M, DEFAULT_SECTION_B_MM, DEFAULT_SECTION_H_MM } from './constants.js';
import { isFixedSupport, braceDiagonals, resolveWallDisplayOffset } from './view-semantics.js';
import { roofPlanPoints, roofVertices3D } from './roof-geometry.js';
import {
  isGableWallSurfaceType,
  isSlopedSurfaceType,
  isWallSurfaceType,
  normalizeBeam3DSectionMode,
} from './state.js';
import { resolveSurfaceVerticalRange } from './quantities.js';

// --- Display constants -----------------------------------------------------
// Surface fill opacities (each multiplied by the per-layer alpha at draw time).
const SURFACE_OPACITY = {
  wall: 0.35,
  floor: 0.45,
  gableWall: 0.38,
  roof: 0.58,
};
// Black box-edge / outline opacities. Historically 0.25 on surfaces and 0.3 on
// members; these deliberately differ, so they are passed per call site.
const SURFACE_EDGE_OPACITY = 0.25;
const MEMBER_EDGE_OPACITY = 0.3;
const GABLE_OUTLINE_OPACITY = 0.28;
const ROOF_OUTLINE_OPACITY = 0.35;
const BRACE_FRAME_OPACITY = 0.3;
const AREA_LOAD_OPACITY = 0.35;

// Display thicknesses / lifts, in scene meters.
const SLAB_DISPLAY_THICKNESS_M = 0.12;   // rendered floor-slab thickness
const SLAB_REST_LIFT_M = 0.06;           // lift a shape-slab above its rest Y
const WALL_DISPLAY_THICKNESS_M = 0.05;   // rendered wall thickness
const LOAD_PLANE_LIFT_M = 0.05;          // lift loads above their level plane
const AREA_LOAD_THICKNESS_M = 0.05;
const NODE_SPHERE_RADIUS_M = 0.06;
const POINT_LOAD_RADIUS_M = 0.15;
// Support symbol geometry (meters).
const SUPPORT_CONE_RADIUS_M = 0.12;
const SUPPORT_CONE_HEIGHT_M = 0.22;
const SUPPORT_PLATE_THICKNESS_M = 0.03;
const SUPPORT_ROLLER_RADIUS_M = 0.055;

// Highlight color for the selected element (matches the 2D selection accent).
const SELECTED_COLOR_3D = '#f38ba8';
// Pointer movement (px) below which a pointerup counts as a pick click.
const PICK_CLICK_MAX_PX = 5;

export class Viewer3D {
  constructor(containerEl, state) {
    this.container = containerEl;
    this.state = state;

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.ambientLight = null;
    this.directionalLight = null;
    this.memberGroup = null;
    this.nodeGroup = null;
    this.surfaceGroup = null;
    this.loadGroup = null;
    this.supportGroup = null;

    this.showWireframe = false;
    this.showNodes = true;
    this.gridHelper = null;
    this.originAxes = null;

    this._initialized = false;
    this._disposed = false;
    this._frames = new FrameScheduler(() => this.animate(), { active: false });
    this._index = new RenderIndex();
    this._visuals = new Map();
    this._baseMaterials = new Map();
    this._highlightMaterials = new Map();
    this._selection = new Map();
    this._isolation = null;
    this.clipping = null;
    this._clipPlane = null;
    this._displayStamp = null;
    this.stats = { frames: 0, rebuilds: 0, selectionUpdates: 0 };
    this._sceneDirty = true;
    this._pendingInitialCamera = true;

    // Click-to-select support: app.js sets onPick to receive {kind, id}.
    this.onPick = null;
    this._pickPointers = new Map();
    this._pickGesture = null;
    this._raycaster = null;

    // Shared material caches keyed by color/opacity so identical surfaces,
    // members, edges and lines reuse one GPU material instead of allocating a
    // fresh (or cloned) one per object. Geometries stay per-object and are
    // disposed by _clearGroup; the cached materials are theme-independent
    // (fixed colors, black edges) and live until dispose().
    this._matCache = new Map();
    this._lineMatCache = new Map();

    // Per-rebuild lookups (see _buildLevelMaps).
    this._levelZMm = null;
    this._maxBeamHMByLevel = null;
    this._nodeLevelId = null;
  }

  init() {
    if (this._disposed) throw new Error('Viewer3D has been disposed');
    if (this._initialized) return;
    if (THREE.REVISION !== '170') throw new Error('Viewer3D requires Three.js 0.170.0');
    this._initialized = true;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1e1e2e);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.renderer.clippingPlanes = this._clipPlane ? [this._clipPlane] : [];
    this.container.appendChild(this.renderer.domElement);

    this._onControlsChange = () => this.requestRender();
    this.controls = this._createOrbitControls();
    this._setFallbackObliqueView();

    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(this.ambientLight);
    this.directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    this.directionalLight.position.set(10, 20, 10);
    this.scene.add(this.directionalLight);

    this.gridHelper = new THREE.GridHelper(50, 50, 0x444466, 0x333355);
    this.scene.add(this.gridHelper);

    this.originAxes = this._createOriginPlanAxes(1.2);
    this.scene.add(this.originAxes);

    this.surfaceGroup = new THREE.Group();
    this.scene.add(this.surfaceGroup);
    this.memberGroup = new THREE.Group();
    this.scene.add(this.memberGroup);
    this.nodeGroup = new THREE.Group();
    this.scene.add(this.nodeGroup);
    this.loadGroup = new THREE.Group();
    this.scene.add(this.loadGroup);
    this.supportGroup = new THREE.Group();
    this.scene.add(this.supportGroup);

    this.applyTheme();

    this.resize();

    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(this.container);

    this._raycaster = new THREE.Raycaster();
    this._onPointerDown = e => this._beginPickGesture(e);
    this._onPointerMove = e => this._movePickGesture(e);
    this._onPointerUp = e => this._endPickGesture(e);
    this._onPointerCancel = e => this._cancelPickGesture(e);
    this._onLostPointerCapture = e => this._lostPickPointerCapture(e);
    this._onWindowBlur = () => this._cancelPointerInteraction();
    this._onVisibilityChange = () => {
      if (this._eventDocument.hidden) this._cancelPointerInteraction();
    };
    this._eventDocument = this.renderer.domElement.ownerDocument;
    this._eventWindow = this._eventDocument.defaultView;
    this.renderer.domElement.addEventListener('pointerdown', this._onPointerDown);
    this.renderer.domElement.addEventListener('pointermove', this._onPointerMove);
    this.renderer.domElement.addEventListener('pointerup', this._onPointerUp);
    this.renderer.domElement.addEventListener('pointercancel', this._onPointerCancel);
    this.renderer.domElement.addEventListener('lostpointercapture', this._onLostPointerCapture);
    this._eventWindow.addEventListener('blur', this._onWindowBlur);
    this._eventDocument.addEventListener('visibilitychange', this._onVisibilityChange);
  }

  _createOrbitControls(target = null) {
    const position = this.camera.position.clone();
    const controls = new OrbitControls(this.camera, this.renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.enablePan = true;
    controls.zoomToCursor = true;
    if (target) {
      this.camera.position.copy(position);
      controls.target.copy(target);
      controls.update();
    }
    controls.addEventListener('change', this._onControlsChange);
    return controls;
  }

  _cancelPointerInteraction() {
    if (!this._pickPointers.size) return;
    this._pickPointers.clear();
    this._pickGesture = null;
    if (!this.controls || this._disposed) return;
    const target = this.controls.target.clone();
    this.controls.removeEventListener('change', this._onControlsChange);
    this.controls.dispose();
    // r170 has no public gesture-cancel API. Recreate controls to discard its
    // stale pointer IDs as well, without a synthetic release on inactive IDs.
    this.controls = this._createOrbitControls(target);
  }

  _lostPickPointerCapture(event) {
    const pointer = this._pickPointers.get(event.pointerId);
    if (!pointer) return;
    // Let every normal pointerup listener finish, including when controls
    // releases capture before our picking listener runs. Only an abandoned
    // pointer that is still the same gesture requires a reset.
    Promise.resolve().then(() => {
      if (this._pickPointers.get(event.pointerId) === pointer) this._cancelPointerInteraction();
    });
  }

  _beginPickGesture(event) {
    const singlePointer = this._pickPointers.size === 0;
    this._pickPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this._pickGesture = singlePointer && event.button === 0 && event.isPrimary !== false &&
      !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey
      ? { pointerId: event.pointerId, distance: 0 } : null;
  }

  _movePickGesture(event) {
    const previous = this._pickPointers.get(event.pointerId);
    if (!previous) return;
    const gesture = this._pickGesture;
    if (gesture?.pointerId === event.pointerId) {
      // Total travel also rejects an orbit that returns to its starting point.
      gesture.distance += Math.hypot(event.clientX - previous.x, event.clientY - previous.y);
      if (gesture.distance > PICK_CLICK_MAX_PX || event.buttons > 1 ||
          event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
        this._pickGesture = null;
      }
    }
    previous.x = event.clientX;
    previous.y = event.clientY;
  }

  _endPickGesture(event) {
    this._movePickGesture(event);
    this._pickPointers.delete(event.pointerId);
    const gesture = this._pickGesture;
    if (gesture?.pointerId !== event.pointerId) return;
    this._pickGesture = null;
    if (event.button === 0 && this._pickPointers.size === 0) this._pickAt(event.clientX, event.clientY);
  }

  _cancelPickGesture(event) {
    this._pickPointers.delete(event.pointerId);
    this._pickGesture = null;
  }

  // Raycasts the member/surface groups at the given client position and
  // reports the first element carrying pick metadata.
  _pickAt(clientX, clientY) {
    if (!this.onPick || !this._raycaster) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this._syncScene();
    this.scene.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this._raycaster.setFromCamera(ndc, this.camera);
    const hits = this._raycaster.intersectObjects(this._contentGroups(), true);
    for (const hit of hits) {
      if (!isVisibleHit(hit, this._clipPlane)) continue;
      let obj = hit.object;
      while (obj && !obj.userData?.pick) obj = obj.parent;
      if (obj?.userData?.pick) {
        this.onPick(obj.userData.pick);
        return;
      }
    }
    this.onPick(null);
  }

  // Coordinate-system rule (single source of truth):
  // A 2D plan point (x, y in mm) at height z (mm) maps to the 3D scene as
  //   scene.x =  x   (mm -> m)
  //   scene.y =  z   (height, mm -> m)
  //   scene.z = -y   (plan Y runs into the scene's -Z, mm -> m)
  _toScene(x, y, z = 0) {
    return new THREE.Vector3(x * MM_TO_M, z * MM_TO_M, -y * MM_TO_M);
  }

  // Scene point directly above a plan node at a given scene-Y (meters).
  _sceneAt(node, sceneY) {
    const v = this._toScene(node.x, node.y, 0);
    v.y = sceneY;
    return v;
  }

  // --- Material cache ------------------------------------------------------
  _standardMaterial({ color, opacity = 1, transparent, wireframe = false, side = THREE.FrontSide }) {
    const isTransparent = transparent === undefined ? opacity < 1 : transparent;
    const key = `${color}|${opacity.toFixed(4)}|${isTransparent ? 1 : 0}|${wireframe ? 1 : 0}|${side}`;
    let mat = this._matCache.get(key);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(color),
        transparent: isTransparent,
        opacity,
        wireframe,
        side,
      });
      this._matCache.set(key, mat);
    }
    return mat;
  }

  _lineMaterial({ color, opacity = 1, transparent, linewidth = 1 }) {
    const isTransparent = transparent === undefined ? opacity < 1 : transparent;
    const key = `${color}|${opacity.toFixed(4)}|${isTransparent ? 1 : 0}|${linewidth}`;
    let mat = this._lineMatCache.get(key);
    if (!mat) {
      mat = new THREE.LineBasicMaterial({
        color: new THREE.Color(color),
        transparent: isTransparent,
        opacity,
        linewidth,
      });
      this._lineMatCache.set(key, mat);
    }
    return mat;
  }

  _disposeMaterialCache() {
    for (const mat of this._matCache.values()) mat.dispose();
    for (const mat of this._lineMatCache.values()) mat.dispose();
    this._matCache.clear();
    this._lineMatCache.clear();
  }

  // Adds a Box mesh plus (optionally) its black edge outline to a group,
  // reusing cached materials. `rotation` (Euler) or `quaternion` orients it.
  _addBoxWithEdges(group, {
    size, position, rotation, quaternion,
    color, opacity = 1, transparent, wireframe = false, side = THREE.FrontSide,
    edgeOpacity = null,
  }) {
    const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
    const material = this._standardMaterial({ color, opacity, transparent, wireframe, side });
    const mesh = new THREE.Mesh(geometry, material);
    if (position) mesh.position.copy(position);
    if (quaternion) mesh.quaternion.copy(quaternion);
    else if (rotation) mesh.rotation.copy(rotation);
    group.add(mesh);

    if (!wireframe && edgeOpacity !== null) {
      const edges = new THREE.EdgesGeometry(geometry);
      const lineMat = this._lineMaterial({ color: 0x000000, opacity: edgeOpacity });
      const seg = new THREE.LineSegments(edges, lineMat);
      seg.userData.outline = true;
      seg.position.copy(mesh.position);
      seg.quaternion.copy(mesh.quaternion);
      group.add(seg);
    }
    return mesh;
  }

  _setFallbackObliqueView() {
    this._fitContentBox(new THREE.Box3(new THREE.Vector3(-5, 0, -5), new THREE.Vector3(5, 0, 5)),
      new THREE.Vector3(1, 0.8, 1));
  }

  _computeContentBounds({ picks = null, clipped = false, visibleOnly = true, includeNodes = false } = {}) {
    const box = new THREE.Box3();
    const entries = picks
      ? picks.map(pick => [`${pick.kind}:${pick.id}`, this._visuals.get(`${pick.kind}:${pick.id}`) || []])
      : this._visuals;
    const equation = clipped && this.clipping
      ? clippingEquation(this.clipping.axis, this.clipping.positionMm, this.clipping.flipped) : null;
    const clipIndex = equation?.normal.findIndex(n => n !== 0);
    const clipAxis = equation ? ['x', 'y', 'z'][clipIndex] : null;
    for (const [key, objects] of entries) {
      // Standalone nodes and decorative helpers must not enlarge whole-model fit.
      if (!picks && !includeNodes && key.startsWith('node:')) continue;
      for (const object of objects) {
        let visible = true;
        for (let ancestor = object; ancestor; ancestor = ancestor.parent) visible &&= ancestor.visible;
        if (visibleOnly && !visible) continue;
        const objectBox = new THREE.Box3().setFromObject(object);
        if (![...objectBox.min.toArray(), ...objectBox.max.toArray()].every(Number.isFinite)) continue;
        if (equation) {
          const cut = -equation.constant / equation.normal[clipIndex];
          if (equation.normal[clipIndex] > 0) objectBox.min[clipAxis] = Math.max(objectBox.min[clipAxis], cut);
          else objectBox.max[clipAxis] = Math.min(objectBox.max[clipAxis], cut);
        }
        // Clip each element first so a fully cut element cannot enlarge a union.
        if (!objectBox.isEmpty()) box.union(objectBox);
      }
    }
    return { box, hasContent: !box.isEmpty() };
  }

  _autoFrameObliqueView(bounds = null) {
    const { box, hasContent } = bounds || this._computeContentBounds();
    if (!hasContent) {
      this._setFallbackObliqueView();
      return;
    }
    this._fitContentBox(box, new THREE.Vector3(1, 0.8, 1));
  }

  _createOriginPlanAxes(length = 1.2) {
    // 2D plan Y is mapped to -Z in the 3D scene.
    const origin = new THREE.Vector3(0, 0, 0);
    const headLength = Math.max(0.18, length * 0.28);
    const headWidth = Math.max(0.1, length * 0.16);

    const xArrow = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0),
      origin.clone(),
      length,
      0xff4d4d,
      headLength,
      headWidth
    );
    const yArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, -1),
      origin.clone(),
      length,
      0x4dff88,
      headLength,
      headWidth
    );
    const zArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 1, 0),
      origin.clone(),
      length,
      0x4da6ff,
      headLength,
      headWidth
    );

    for (const arrow of [xArrow, yArrow, zArrow]) {
      arrow.line.material.depthTest = false;
      arrow.line.material.depthWrite = false;
      arrow.line.material.toneMapped = false;
      arrow.cone.material.depthTest = false;
      arrow.cone.material.depthWrite = false;
      arrow.cone.material.toneMapped = false;
      arrow.renderOrder = 999;
    }

    const group = new THREE.Group();
    group.add(xArrow);
    group.add(yArrow);
    group.add(zArrow);
    return group;
  }

  _positionOriginAxes(bounds = null) {
    if (!this.originAxes) return;
    const { box, hasContent } = bounds || this._computeContentBounds();
    if (!hasContent) {
      this.originAxes.position.set(-4, 0.4, 4);
      return;
    }

    const size = box.getSize(new THREE.Vector3());
    const planSpan = Math.max(size.x, size.z, 4);
    const pad = Math.max(2.0, planSpan * 0.22);
    const lift = Math.max(0.25, Math.min(1.0, size.y * 0.08));

    // Place far away from the plan's lower-left corner for readability.
    const x = box.min.x - pad;
    const z = box.max.z + pad;
    this.originAxes.position.set(x, box.min.y + lift, z);
  }

  resize() {
    if (!this.renderer) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.requestRender();
  }

  _clearGroup(group) {
    disposeObjects([group], { materials: false });
    group.clear();
  }

  _contentGroups() {
    return [this.surfaceGroup, this.memberGroup, this.nodeGroup, this.loadGroup, this.supportGroup].filter(Boolean);
  }

  // Builds the per-rebuild lookups so the surface/member/node/load/support
  // passes can resolve level elevations and floor rest heights in O(1) instead
  // of scanning levels/members repeatedly.
  _buildLevelMaps() {
    const levelZ = new Map();
    for (const l of this.state.levels || []) levelZ.set(l.id, Number(l.z) || 0);
    this._levelZMm = levelZ;

    // levelId -> max visible beam depth (meters); node -> levelId of the first
    // member (in array order) that touches it.
    const maxBeamH = new Map();
    const nodeLevelId = new Map();
    for (const m of this.state.members || []) {
      if (!nodeLevelId.has(m.startNodeId)) nodeLevelId.set(m.startNodeId, m.levelId);
      if (!nodeLevelId.has(m.endNodeId)) nodeLevelId.set(m.endNodeId, m.levelId);
      if (m.type !== 'beam') continue;
      if (!this.state.isMemberVisible(m, '3d')) continue;
      const h = (m.section?.h || DEFAULT_SECTION_H_MM) * MM_TO_M;
      const cur = maxBeamH.get(m.levelId);
      if (cur === undefined || h > cur) maxBeamH.set(m.levelId, h);
    }
    this._maxBeamHMByLevel = maxBeamH;
    this._nodeLevelId = nodeLevelId;
  }

  // Level elevation in scene meters (falls back to state.getLevelZ()).
  _levelZm(levelId) {
    const z = this._levelZMm?.get(levelId);
    return (z === undefined ? this.state.getLevelZ(levelId) : z) * MM_TO_M;
  }

  rebuildScene() {
    if (!this._initialized) return;
    this._sceneDirty = false;
    this.stats.rebuilds++;
    this._visuals.clear();
    this._baseMaterials.clear();
    this._selection = new Map();
    this._index.update(this.state, true);
    this._displayStamp = displayStamp(this.state);

    this._clearGroup(this.surfaceGroup);
    this._clearGroup(this.memberGroup);
    this._clearGroup(this.nodeGroup);
    this._clearGroup(this.loadGroup);
    this._clearGroup(this.supportGroup);

    this._buildLevelMaps();

    this._buildSurfaces();
    const visibleMemberNodeIds = this._buildMembers();
    this._buildNodes(visibleMemberNodeIds);
    this._buildLoads();
    this._buildSupports();

    this._pruneMaterials();
    this.updateSelection();
    this._applyIsolation();
    const bounds = this._computeContentBounds();
    this._positionOriginAxes(bounds);

    if (this._pendingInitialCamera) {
      this._autoFrameObliqueView(this._computeContentBounds({ clipped: true }));
      this._pendingInitialCamera = false;
    }
  }

  // Selection-aware colors shared by every member / surface builder.
  _memberColor(member) {
    return resolveMemberColor(member);
  }

  _surfaceColor(surface) {
    return resolveSurfaceColor(surface);
  }

  // Tags every object added to `group` after index `fromIndex` with pick
  // metadata so raycast hits resolve back to the model element.
  _tagPickRange(group, fromIndex, pick) {
    for (let i = fromIndex; i < group.children.length; i++) {
      const object = group.children[i];
      object.userData.pick = pick;
      object.name = `${pick.kind}:${pick.id}`;
      const source = this._index[`${pick.kind === 'surface' ? 'surfaces' : pick.kind + 's'}ById`]?.get(pick.id);
      object.userData.element = { kind: pick.kind, id: pick.id,
        type: source?.type, levelId: source?.levelId, sectionName: source?.sectionName };
      const key = `${pick.kind}:${pick.id}`;
      const objects = this._visuals.get(key) || [];
      objects.push(object);
      this._visuals.set(key, objects);
      if (object.material) this._baseMaterials.set(object, object.material);
    }
  }

  _buildSurfaces() {
    for (const s of this.state.surfaces || []) {
      if (!this.state.isSurfaceVisible(s, '3d')) continue;
      const childrenBefore = this.surfaceGroup.children.length;
      const layerAlpha = this.state.getPlanLayerStyle(s.levelId, { view: '3d' }).alpha;
      const range = resolveSurfaceVerticalRange(this.state, s);
      const base = range.bottom;
      const top = range.top;
      const isPolygon = s.shape === 'polygon' && Array.isArray(s.points) && s.points.length >= 3;

      if (isSlopedSurfaceType(s.type)) {
        this._addRoofSurface3D(s, layerAlpha);
      } else if (isPolygon) {
        if (s.type === 'exteriorWall') {
          this._addExteriorWallEdges3D(s, base, top, layerAlpha);
        } else {
          this._addPolygonSurface3D(s, base, top, layerAlpha);
        }
      } else if (s.shape === 'line') {
        if (isGableWallSurfaceType(s.type)) {
          this._addGableWallLine3D(s, layerAlpha);
        } else {
          this._addWallLine3D(s, base, top, layerAlpha);
        }
      } else {
        this._addSurfaceBox3D(s, base, top, layerAlpha);
      }

      this._tagPickRange(this.surfaceGroup, childrenBefore, { kind: 'surface', id: s.id });
    }
  }

  // Axis-aligned surface rectangle (non-polygon, non-line). Walls stand up over
  // their vertical range; floors read as a slab resting on the framing.
  _addSurfaceBox3D(s, base, top, opacityMultiplier = 1) {
    const xSize = Math.max(0.01, Math.abs(s.x2 - s.x1) * MM_TO_M);
    const zSize = Math.max(0.01, Math.abs(s.y2 - s.y1) * MM_TO_M);
    const isWallType = isWallSurfaceType(s.type);

    let ySize;
    let yCenterM;
    if (isWallType) {
      ySize = Math.max(0.1, Math.abs(top - base) * MM_TO_M);
      yCenterM = Math.min(base, top) * MM_TO_M + ySize / 2;
    } else {
      // Floors sit on top of the beams at their level so they read as a slab
      // resting on the framing rather than slicing through it.
      ySize = SLAB_DISPLAY_THICKNESS_M;
      yCenterM = this._floorRestY(s, base) + ySize / 2;
    }

    const center = this._toScene((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2, 0);
    center.y = yCenterM;

    this._addBoxWithEdges(this.surfaceGroup, {
      size: { x: xSize, y: ySize, z: zSize },
      position: center,
      color: this._surfaceColor(s),
      opacity: (isWallType ? SURFACE_OPACITY.wall : SURFACE_OPACITY.floor) * opacityMultiplier,
      edgeOpacity: SURFACE_EDGE_OPACITY * opacityMultiplier,
    });
  }

  requestRebuild({ force = false } = {}) {
    if (this._disposed) return;
    const changed = this._index.update(this.state, force);
    this._sceneDirty ||= force || changed || this._displayStamp !== displayStamp(this.state);
    this.requestRender();
  }

  requestRender() {
    if (this._disposed) return;
    if (this.container.hidden) this._frames.setActive(false);
    this._frames.invalidate();
  }

  requestSelectionUpdate() {
    // Also checks model revision, so a selection immediately following an edit
    // cannot accidentally suppress its geometry update.
    this.requestRebuild();
  }

  requestDisplayUpdate() {
    this.requestRebuild();
  }

  _syncScene() {
    if (this._index.update(this.state) || this._displayStamp !== displayStamp(this.state)) this._sceneDirty = true;
    if (this._sceneDirty) this.rebuildScene();
    else this.updateSelection();
  }

  updateSelection() {
    const next = selectedElements(this.state);
    const changed = new Set([...this._selection.keys(), ...next.keys()]);
    let updated = false;
    for (const key of changed) {
      if (this._selection.has(key) === next.has(key)) continue;
      for (const object of this._visuals.get(key) || []) {
        const base = this._baseMaterials.get(object);
        if (!base) continue;
        // Keep black edge outlines black; highlight colored member lines too.
        if (object.userData.outline) continue;
        if (!next.has(key)) object.material = base;
        else {
          let highlighted = this._highlightMaterials.get(base);
          if (!highlighted) {
            highlighted = base.clone();
            highlighted.color.set(SELECTED_COLOR_3D);
            this._highlightMaterials.set(base, highlighted);
          }
          object.material = highlighted;
        }
        updated = true;
      }
    }
    this._selection = next;
    if (updated) this.stats.selectionUpdates++;
  }

  _pruneMaterials() {
    const used = new Set();
    for (const group of this._contentGroups()) group.traverse(object => {
      if (object.material) used.add(object.material);
    });
    for (const cache of [this._matCache, this._lineMatCache]) {
      for (const [key, material] of cache) if (!used.has(material)) {
        material.dispose();
        cache.delete(key);
      }
    }
    for (const [base, material] of this._highlightMaterials) if (!used.has(base)) {
      material.dispose();
      this._highlightMaterials.delete(base);
    }
  }

  // Draws one wall segment as an oriented box + edges between two plan points.
  _addWallSegmentBox3D(a, b, yBaseM, heightM, color, opacityMultiplier = 1) {
    const start = this._toScene(a.x, a.y, 0);
    const end = this._toScene(b.x, b.y, 0);
    const direction = new THREE.Vector3().subVectors(end, start);
    const length = direction.length();
    if (length < 0.001) return;

    const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
    mid.y = yBaseM + heightM / 2;
    const rotation = new THREE.Euler(0, -Math.atan2(direction.z, direction.x), 0);

    this._addBoxWithEdges(this.surfaceGroup, {
      size: { x: length, y: heightM, z: WALL_DISPLAY_THICKNESS_M },
      position: mid,
      rotation,
      color,
      opacity: SURFACE_OPACITY.wall * opacityMultiplier,
      edgeOpacity: SURFACE_EDGE_OPACITY * opacityMultiplier,
    });
  }

  _addWallLine3D(surface, base, top, opacityMultiplier = 1) {
    const heightM = Math.max(0.1, Math.abs(top - base) * MM_TO_M);
    const yBaseM = Math.min(base, top) * MM_TO_M;
    this._addWallSegmentBox3D(
      { x: surface.x1, y: surface.y1 },
      { x: surface.x2, y: surface.y2 },
      yBaseM, heightM, this._surfaceColor(surface), opacityMultiplier
    );
  }

  _addGableWallLine3D(surface, opacityMultiplier = 1) {
    const baseZ = this.state.getLevelZ(surface.levelId);
    const topFallback = finiteNumber(surface.topOffset, 0);
    const bottomZmm = baseZ + finiteNumber(surface.bottomOffset, 0);
    const startTopZmm = baseZ + finiteNumber(surface.gableStartTopOffset, topFallback);
    const endTopZmm = baseZ + finiteNumber(surface.gableEndTopOffset, topFallback);
    const bottomY = bottomZmm * MM_TO_M;
    if (Math.max(startTopZmm, endTopZmm) * MM_TO_M - bottomY < 0.001) return;

    const vertices = [
      this._toScene(surface.x1, surface.y1, bottomZmm),
      this._toScene(surface.x2, surface.y2, bottomZmm),
      this._toScene(surface.x2, surface.y2, endTopZmm),
      this._toScene(surface.x1, surface.y1, startTopZmm),
    ];
    const geometry = new THREE.BufferGeometry().setFromPoints(vertices);
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.computeVertexNormals();
    const material = this._standardMaterial({
      color: this._surfaceColor(surface),
      opacity: SURFACE_OPACITY.gableWall * opacityMultiplier,
      side: THREE.DoubleSide,
    });
    this.surfaceGroup.add(new THREE.Mesh(geometry, material));

    const outline = [...vertices, vertices[0]];
    const outlineGeo = new THREE.BufferGeometry().setFromPoints(outline);
    const outlineMat = this._lineMaterial({ color: 0x000000, opacity: GABLE_OUTLINE_OPACITY * opacityMultiplier });
    const outlineObject = new THREE.Line(outlineGeo, outlineMat);
    outlineObject.userData.outline = true;
    this.surfaceGroup.add(outlineObject);
  }

  _buildMembers() {
    const visibleMemberNodeIds = new Set();
    for (const m of this.state.members) {
      if (!this.state.isMemberVisible(m, '3d')) continue;
      const childrenBefore = this.memberGroup.children.length;
      this._buildMemberVisual(m, visibleMemberNodeIds);
      this._tagPickRange(this.memberGroup, childrenBefore, { kind: 'member', id: m.id });
    }
    return visibleMemberNodeIds;
  }

  _buildMemberVisual(m, visibleMemberNodeIds) {
    const layerAlpha = this.state.getPlanLayerStyle(m.levelId, { view: '3d' }).alpha;
    const n1 = this._index.nodesById.get(m.startNodeId);
    if (!n1) return;
    visibleMemberNodeIds.add(m.startNodeId);
    visibleMemberNodeIds.add(m.endNodeId);

    if (m.type === 'column') {
      this._addColumn3D(m, n1, layerAlpha);
      return;
    }

    const n2 = this._index.nodesById.get(m.endNodeId);
    if (!n2) return;

    if (m.type === 'vbrace') {
      this._addVBrace3D(m, n1, n2, layerAlpha);
      return;
    }

    const levelYm = this._levelZm(m.levelId);
    const startY = m.geometryMode === 'explicit3d' && Number.isFinite(Number(m.startZ))
      ? Number(m.startZ) * MM_TO_M
      : levelYm;
    const endY = m.geometryMode === 'explicit3d' && Number.isFinite(Number(m.endZ))
      ? Number(m.endZ) * MM_TO_M
      : levelYm;

    const start = this._toScene(n1.x, n1.y, 0);
    start.y = startY;
    const end = this._toScene(n2.x, n2.y, 0);
    end.y = endY;

    const direction = new THREE.Vector3().subVectors(end, start);
    const length = direction.length();
    if (length < 0.001) return;

    if (this._isMemberLineMode()) {
      this._addMemberLine3D(start, end, this._memberColor(m), layerAlpha);
      return;
    }

    const b = (m.section?.b || DEFAULT_SECTION_B_MM) * MM_TO_M;
    const h = (m.section?.h || DEFAULT_SECTION_H_MM) * MM_TO_M;

    const color = this._memberColor(m);
    if (m.type === 'beam' && this._beam3DSectionMode() !== 'box') {
      this._addBeamHSection3D(start, end, direction, length, b, h, color, layerAlpha);
      return;
    }

    this._addMemberBox3D(start, end, direction, length, b, h, color, layerAlpha);
  }

  _buildNodes(visibleMemberNodeIds) {
    if (!this.showNodes || !visibleMemberNodeIds.size) return;
    const sphereGeo = new THREE.SphereGeometry(NODE_SPHERE_RADIUS_M, 8, 8);
    const material = this._standardMaterial({ color: 0x89b4fa, opacity: 1 });

    for (const n of this.state.nodes) {
      if (!visibleMemberNodeIds.has(n.id)) continue;
      const levelId = this._nodeLevelId?.get(n.id);
      const y = levelId === undefined ? 0 : this._levelZm(levelId);
      const sphere = new THREE.Mesh(sphereGeo, material);
      sphere.position.copy(this._sceneAt(n, y));
      const from = this.nodeGroup.children.length;
      this.nodeGroup.add(sphere);
      this._tagPickRange(this.nodeGroup, from, { kind: 'node', id: n.id });
    }
  }

  _buildLoads() {
    for (const ld of this.state.loads || []) {
      if (!this.state.isLoadVisible(ld, '3d')) continue;
      const from = this.loadGroup.children.length;
      const layerAlpha = this.state.getPlanLayerStyle(ld.levelId, { view: '3d' }).alpha;
      const y = this._levelZm(ld.levelId) + LOAD_PLANE_LIFT_M;
      const color = resolveLoadColor(ld);

      if (ld.type === 'areaLoad') {
        const xSize = Math.abs(ld.x2 - ld.x1) * MM_TO_M;
        const zSize = Math.abs(ld.y2 - ld.y1) * MM_TO_M;
        const center = this._toScene((ld.x1 + ld.x2) / 2, (ld.y1 + ld.y2) / 2, 0);
        center.y = y;
        const geo = new THREE.BoxGeometry(xSize, AREA_LOAD_THICKNESS_M, zSize);
        const mat = this._standardMaterial({ color, opacity: AREA_LOAD_OPACITY * layerAlpha });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(center);
        this.loadGroup.add(mesh);
      } else if (ld.type === 'lineLoad') {
        const pts = [this._sceneAt({ x: ld.x1, y: ld.y1 }, y), this._sceneAt({ x: ld.x2, y: ld.y2 }, y)];
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const mat = this._lineMaterial({ color, opacity: layerAlpha, transparent: layerAlpha < 1, linewidth: 2 });
        this.loadGroup.add(new THREE.Line(geo, mat));
      } else if (ld.type === 'pointLoad') {
        const geo = new THREE.SphereGeometry(POINT_LOAD_RADIUS_M, 8, 8);
        const mat = this._standardMaterial({ color, opacity: layerAlpha, transparent: layerAlpha < 1 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(this._sceneAt({ x: ld.x1, y: ld.y1 }, y));
        this.loadGroup.add(mesh);
      }
      this._tagPickRange(this.loadGroup, from, { kind: 'load', id: ld.id });
    }
  }

  _buildSupports() {
    if (!this.state.settings.showSupports) return;
    for (const sup of this.state.supports || []) {
      if (!this.state.isSupportVisible(sup, '3d')) continue;
      const layerAlpha = this.state.getPlanLayerStyle(sup.levelId, { view: '3d' }).alpha;
      const y = this._levelZm(sup.levelId);
      const from = this.supportGroup.children.length;
      this._addSupport3D(sup, y, layerAlpha);
      this._tagPickRange(this.supportGroup, from, { kind: 'support', id: sup.id });
    }
  }

  _addColumn3D(member, node, opacityMultiplier = 1) {
    if (!this._levelZMm?.has(member.levelId) || !this._levelZMm?.has(member.topLevelId)) return;

    const bottomZ = this._levelZm(member.levelId);
    const topZ = this._levelZm(member.topLevelId);
    const height = Math.abs(topZ - bottomZ);
    if (height < 0.001) return;

    if (this._isMemberLineMode()) {
      const start = this._sceneAt(node, bottomZ);
      const end = this._sceneAt(node, topZ);
      this._addMemberLine3D(start, end, this._memberColor(member), opacityMultiplier);
      return;
    }

    const b = (member.section?.b || DEFAULT_SECTION_B_MM) * MM_TO_M;
    const h = (member.section?.h || DEFAULT_SECTION_B_MM) * MM_TO_M;

    const center = this._sceneAt(node, (bottomZ + topZ) / 2);
    this._addBoxWithEdges(this.memberGroup, {
      size: { x: b, y: height, z: h },
      position: center,
      color: this._memberColor(member),
      opacity: opacityMultiplier,
      wireframe: this.showWireframe,
      edgeOpacity: this.showWireframe ? null : MEMBER_EDGE_OPACITY * opacityMultiplier,
    });
  }

  _addMemberBox3D(start, end, direction, length, width, height, color, opacityMultiplier = 1) {
    const center = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
    center.y += height / 2;
    const quat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(1, 0, 0),
      direction.clone().normalize()
    );
    this._addMemberBoxPart3D(length, height, width, center, quat, new THREE.Vector3(), color, opacityMultiplier);
  }

  _addBeamHSection3D(start, end, direction, length, width, height, color, opacityMultiplier = 1) {
    const mode = this._beam3DSectionMode();
    const strongAxis = mode === 'hStrong';
    const totalY = Math.max(0.01, strongAxis ? height : width);
    const totalZ = Math.max(0.01, strongAxis ? width : height);
    const sourceDepth = Math.max(0.01, height);
    const sourceWidth = Math.max(0.01, width);
    // H-section plate thicknesses are visual approximations only. They make the
    // web/flanges legible from the default view and are not structural section data.
    const flangeThickness = Math.min(Math.max(sourceDepth * 0.16, 0.02), sourceDepth * 0.35);
    const webThickness = Math.min(Math.max(sourceWidth * 0.28, 0.015), sourceWidth * 0.65);
    const center = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
    // Use the rendered section depth so box, strong-axis, and weak-axis modes
    // all rest on the same bottom baseline even when b and h differ.
    center.y += totalY / 2;
    const quat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(1, 0, 0),
      direction.clone().normalize()
    );

    if (strongAxis) {
      const webHeight = Math.max(0.01, totalY - flangeThickness * 2);
      const flangeOffset = (totalY - flangeThickness) / 2;
      this._addMemberBoxPart3D(length, flangeThickness, totalZ, center, quat, new THREE.Vector3(0, flangeOffset, 0), color, opacityMultiplier);
      this._addMemberBoxPart3D(length, flangeThickness, totalZ, center, quat, new THREE.Vector3(0, -flangeOffset, 0), color, opacityMultiplier);
      this._addMemberBoxPart3D(length, webHeight, webThickness, center, quat, new THREE.Vector3(), color, opacityMultiplier);
      return;
    }

    const webWidth = Math.max(0.01, totalZ - flangeThickness * 2);
    const flangeOffset = (totalZ - flangeThickness) / 2;
    this._addMemberBoxPart3D(length, totalY, flangeThickness, center, quat, new THREE.Vector3(0, 0, flangeOffset), color, opacityMultiplier);
    this._addMemberBoxPart3D(length, totalY, flangeThickness, center, quat, new THREE.Vector3(0, 0, -flangeOffset), color, opacityMultiplier);
    this._addMemberBoxPart3D(length, webThickness, webWidth, center, quat, new THREE.Vector3(), color, opacityMultiplier);
  }

  _addMemberBoxPart3D(length, height, width, center, quaternion, localOffset, color, opacityMultiplier = 1) {
    const position = center.clone().add(localOffset.clone().applyQuaternion(quaternion));
    this._addBoxWithEdges(this.memberGroup, {
      size: { x: length, y: height, z: width },
      position,
      quaternion,
      color,
      opacity: opacityMultiplier,
      wireframe: this.showWireframe,
      edgeOpacity: this.showWireframe ? null : MEMBER_EDGE_OPACITY * opacityMultiplier,
    });
  }

  _isMemberLineMode() {
    return this.state.settings?.member3dRenderMode === 'line';
  }

  _beam3DSectionMode() {
    return normalizeBeam3DSectionMode(this.state.settings?.beam3dSectionMode);
  }

  _addMemberLine3D(start, end, color, opacityMultiplier = 1) {
    const geo = new THREE.BufferGeometry().setFromPoints([start, end]);
    // Browser WebGL implementations commonly clamp LineBasicMaterial to 1px.
    const mat = this._lineMaterial({
      color: color || '#666666',
      opacity: opacityMultiplier,
      transparent: opacityMultiplier < 1,
      linewidth: 2,
    });
    this.memberGroup.add(new THREE.Line(geo, mat));
  }

  _addVBrace3D(member, n1, n2, opacityMultiplier = 1) {
    if (!this._levelZMm?.has(member.levelId) || !this._levelZMm?.has(member.topLevelId)) return;

    const yBottom = this._levelZm(member.levelId);
    const yTop = this._levelZm(member.topLevelId);
    const color = this._memberColor(member);
    const mat = this._lineMaterial({ color, opacity: opacityMultiplier, transparent: opacityMultiplier < 1, linewidth: 2 });

    // Corner order matches braceDiagonals(): [start-bottom, end-bottom, end-top, start-top].
    const corners = [
      this._sceneAt(n1, yBottom),
      this._sceneAt(n2, yBottom),
      this._sceneAt(n2, yTop),
      this._sceneAt(n1, yTop),
    ];

    for (const [a, b] of braceDiagonals(member.bracePattern)) {
      const geo = new THREE.BufferGeometry().setFromPoints([corners[a], corners[b]]);
      this.memberGroup.add(new THREE.Line(geo, mat));
    }

    // Frame outline (rectangle)
    const frameGeo = new THREE.BufferGeometry().setFromPoints([corners[0], corners[1], corners[2], corners[3], corners[0]]);
    const frameMat = this._lineMaterial({ color, opacity: BRACE_FRAME_OPACITY * opacityMultiplier });
    this.memberGroup.add(new THREE.Line(frameGeo, frameMat));
  }

  _addPolygonSurface3D(surface, base, top, opacityMultiplier = 1) {
    const points = surface.points.map(p => new THREE.Vector2(p.x * MM_TO_M, p.y * MM_TO_M));
    const shape = new THREE.Shape(points);
    const isWallType = isWallSurfaceType(surface.type);
    const color = this._surfaceColor(surface);

    if (isWallType) {
      const height = Math.max(0.1, Math.abs(top - base) * MM_TO_M);
      const yBase = Math.min(base, top) * MM_TO_M;
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
      const material = this._standardMaterial({ color, opacity: SURFACE_OPACITY.wall * opacityMultiplier });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = yBase;
      this.surfaceGroup.add(mesh);
      return;
    }

    const geometry = new THREE.ShapeGeometry(shape);
    const material = this._standardMaterial({ color, opacity: SURFACE_OPACITY.floor * opacityMultiplier, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    // Rest the slab on top of the beams at its level (falls back to the surface
    // base elevation when no beams are present).
    mesh.position.y = this._floorRestY(surface, base) + SLAB_REST_LIFT_M;
    this.surfaceGroup.add(mesh);
  }

  // Returns the Y (meters) a floor slab should rest at: the top of the tallest
  // visible beam on the floor's level, or the surface base when none exists.
  _floorRestY(surface, base) {
    const baseY = base * MM_TO_M;
    if (!this._levelZMm?.has(surface.levelId)) return baseY;
    const maxBeamH = this._maxBeamHMByLevel?.get(surface.levelId);
    if (maxBeamH === undefined) return baseY;
    return Math.max(baseY, this._levelZm(surface.levelId) + maxBeamH);
  }

  _addExteriorWallEdges3D(surface, base, top, opacityMultiplier = 1) {
    const points = surface.points;
    if (!points || points.length < 2) return;

    const heightM = Math.max(0.1, Math.abs(top - base) * MM_TO_M);
    const yBaseM = Math.min(base, top) * MM_TO_M;
    const wallOffset = resolveWallDisplayOffset(this.state.settings);
    const oPts = offsetPolygonOutward(points, wallOffset);
    const color = this._surfaceColor(surface);

    for (let i = 0; i < oPts.length; i++) {
      this._addWallSegmentBox3D(oPts[i], oPts[(i + 1) % oPts.length], yBaseM, heightM, color, opacityMultiplier);
    }
  }

  _addRoofSurface3D(surface, opacityMultiplier = 1) {
    const planPoints = roofPlanPoints(surface);
    const vertices3D = roofVertices3D(this.state, surface);
    if (planPoints.length < 3 || vertices3D.length !== planPoints.length) return;

    const contour = planPoints.map(p => new THREE.Vector2(p.x * MM_TO_M, -p.y * MM_TO_M));
    // Single-contour triangulation covers simple roof outlines; complex roofs with holes should be split first.
    const triangles = THREE.ShapeUtils.triangulateShape(contour, []);
    if (!triangles.length) return;

    // Roof vertices carry their own height in v.z, matching the _toScene rule
    // (plan x -> x, height -> y, plan y -> -z).
    const positions = [];
    for (const tri of triangles) {
      for (const idx of tri) {
        const v = vertices3D[idx];
        positions.push(v.x * MM_TO_M, v.z * MM_TO_M, -v.y * MM_TO_M);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();

    const material = this._standardMaterial({
      color: this._surfaceColor(surface),
      opacity: SURFACE_OPACITY.roof * opacityMultiplier,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    this.surfaceGroup.add(mesh);

    const outlinePoints = vertices3D.map(v => this._toScene(v.x, v.y, v.z));
    outlinePoints.push(outlinePoints[0].clone());
    const outlineGeo = new THREE.BufferGeometry().setFromPoints(outlinePoints);
    const outlineMat = this._lineMaterial({ color: 0x000000, opacity: ROOF_OUTLINE_OPACITY * opacityMultiplier });
    const outlineObject = new THREE.Line(outlineGeo, outlineMat);
    outlineObject.userData.outline = true;
    this.surfaceGroup.add(outlineObject);
  }

  _addSupport3D(sup, y, opacityMultiplier = 1) {
    const scenePt = this._toScene(sup.x, sup.y, 0);
    const px = scenePt.x;
    const pz = scenePt.z;
    const isFixed = isFixedSupport(sup);

    // Cone (triangle symbol) — apex at the support point, base below
    const coneGeo = new THREE.ConeGeometry(SUPPORT_CONE_RADIUS_M, SUPPORT_CONE_HEIGHT_M, 4);
    const coneMat = this._standardMaterial({ color: SUPPORT_COLOR, opacity: 0.7 * opacityMultiplier });
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.set(px, y - SUPPORT_CONE_HEIGHT_M / 2, pz);
    this.supportGroup.add(cone);

    if (isFixed) {
      // Fixed support: flat box as ground plate
      const plateGeo = new THREE.BoxGeometry(SUPPORT_CONE_RADIUS_M * 2.3, SUPPORT_PLATE_THICKNESS_M, SUPPORT_CONE_RADIUS_M * 2.3);
      const plateMat = this._standardMaterial({ color: SUPPORT_COLOR, opacity: 0.5 * opacityMultiplier });
      const plate = new THREE.Mesh(plateGeo, plateMat);
      plate.position.set(px, y - SUPPORT_CONE_HEIGHT_M - SUPPORT_PLATE_THICKNESS_M / 2, pz);
      this.supportGroup.add(plate);
    } else {
      // Roller / partial: sphere under the cone
      const sphereGeo = new THREE.SphereGeometry(SUPPORT_ROLLER_RADIUS_M, 8, 8);
      const sphereMat = this._standardMaterial({ color: SUPPORT_COLOR, opacity: 0.7 * opacityMultiplier });
      const sphere = new THREE.Mesh(sphereGeo, sphereMat);
      sphere.position.set(px, y - SUPPORT_CONE_HEIGHT_M - SUPPORT_ROLLER_RADIUS_M, pz);
      this.supportGroup.add(sphere);
    }
  }

  animate() {
    if (!this._initialized || this._disposed || !this._frames.active) return;
    if (this.container.hidden) {
      this.stopRendering();
      return;
    }
    this._syncScene();
    // r170 update emits change while damping is moving. The listener schedules
    // the next frame; when it settles there is no outstanding RAF.
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.stats.frames++;
  }

  startRendering() {
    this.init();
    this._frames.setActive(true);
    this.resize();
    this.requestRebuild();
  }

  setActive(active) {
    if (active) this.startRendering();
    else this.stopRendering();
  }

  stopRendering() {
    this._cancelPointerInteraction();
    this._frames.setActive(false);
  }

  toggleWireframe() {
    this.showWireframe = !this.showWireframe;
    this.requestRebuild({ force: true });
  }

  toggleNodes() {
    this.showNodes = !this.showNodes;
    this.requestRebuild({ force: true });
  }

  setClipping(axis, positionMm, flipped = false) {
    const equation = clippingEquation(axis, positionMm, flipped);
    this.clipping = { axis: axis.toUpperCase(), positionMm, flipped };
    this._clipPlane = new THREE.Plane(new THREE.Vector3(...equation.normal), equation.constant);
    if (this.renderer) this.renderer.clippingPlanes = [this._clipPlane];
    this.requestRender();
  }

  clearClipping() {
    this.clipping = null;
    this._clipPlane = null;
    if (this.renderer) this.renderer.clippingPlanes = [];
    this.requestRender();
  }

  getClippingRange(axis) {
    this.init();
    this._syncScene();
    const { box, hasContent } = this._computeContentBounds({ visibleOnly: false, includeNodes: true });
    if (!hasContent) return { min: 0, max: 1000 };
    const ranges = { X: [box.min.x, box.max.x], Y: [-box.max.z, -box.min.z], Z: [box.min.y, box.max.y] };
    const range = ranges[String(axis).toUpperCase()];
    if (!range) throw new TypeError('Invalid clipping axis');
    return { min: range[0] / MM_TO_M, max: range[1] / MM_TO_M };
  }

  isolateSelection() {
    this.init();
    this._syncScene();
    const selected = selectedElements(this.state);
    const visible = [...selected.keys()].filter(key => this._visuals.has(key));
    if (!visible.length) return false;
    // Snapshot: subsequent selection changes must not silently replace isolation.
    this._isolation = new Set(visible);
    this._applyIsolation();
    this.requestRender();
    return true;
  }

  clearIsolation() {
    this._isolation = null;
    this._applyIsolation();
    this.requestRender();
  }

  // A different model must not inherit element IDs or a clipping plane from
  // the previous file. Frame on the next rebuild, including while hidden.
  resetModelView() {
    this.clearClipping();
    this.clearIsolation();
    this._pendingInitialCamera = true;
    this.requestRebuild({ force: true });
  }

  _applyIsolation() {
    for (const [key, objects] of this._visuals) {
      for (const object of objects) object.visible = !this._isolation || this._isolation.has(key);
    }
  }

  focusSelection() {
    return this.focusElements([...selectedElements(this.state).values()]);
  }

  focusElements(picks) {
    this.init();
    this._syncScene();
    const { box, hasContent } = this._computeContentBounds({ picks, clipped: true });
    return hasContent && this._fitContentBox(box);
  }

  focusAll() {
    this.init();
    this._syncScene();
    const { box, hasContent } = this._computeContentBounds({ clipped: true });
    return hasContent && this._fitContentBox(box);
  }

  setViewPreset(name) {
    const directions = {
      oblique: [1, 0.8, 1],
      // Avoid the polar singularity while keeping CAD +Y at screen top.
      top: [0, 1, 1e-6],
      front: [0, 0, 1],
      right: [1, 0, 0],
    };
    if (!Object.hasOwn(directions, name)) return false;
    this.init();
    this._syncScene();
    const { box, hasContent } = this._computeContentBounds({ clipped: true });
    return hasContent && this._fitContentBox(box, new THREE.Vector3(...directions[name]));
  }

  _fitContentBox(box, direction = null) {
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.25);
    // Fit a bounding sphere inside both vertical and horizontal perspective
    // fields, including narrow viewports and the current camera zoom.
    const verticalFov = THREE.MathUtils.degToRad(this.camera.getEffectiveFOV() / 2);
    const halfFov = Math.min(verticalFov, Math.atan(Math.tan(verticalFov) * this.camera.aspect));
    const distance = radius / Math.sin(halfFov) * 1.15;
    const viewDirection = direction?.clone() || this.camera.position.clone().sub(this.controls.target);
    if (!viewDirection.lengthSq()) viewDirection.set(1, 0.8, 1);
    viewDirection.normalize();
    if (![...center.toArray(), ...viewDirection.toArray(), distance].every(Number.isFinite)) return false;
    // Flush old damping deltas before setting a precise new target.
    const damping = this.controls.enableDamping;
    this.controls.enableDamping = false;
    this.controls.update();
    this.camera.position.copy(center).addScaledVector(viewDirection, distance);
    this.controls.target.copy(center);
    this.camera.near = Math.max(0.001, distance / 10000);
    this.camera.far = Math.max(1000, distance + radius * 4);
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(center);
    this.controls.update();
    this.controls.enableDamping = damping;
    this.requestRender();
    return true;
  }

  async exportGLB() {
    this.init();
    this._syncScene();
    const { exportViewerGLB } = await import('./render/glb-export.js');
    if (this._disposed) throw new Error('Viewer3D has been disposed');
    this._syncScene();
    return exportViewerGLB(this);
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._frames.dispose();
    this._resizeObserver?.disconnect();
    this.controls?.removeEventListener('change', this._onControlsChange);
    this.controls?.dispose();
    const canvas = this.renderer?.domElement;
    canvas?.removeEventListener('pointerdown', this._onPointerDown);
    canvas?.removeEventListener('pointermove', this._onPointerMove);
    canvas?.removeEventListener('pointerup', this._onPointerUp);
    canvas?.removeEventListener('pointercancel', this._onPointerCancel);
    canvas?.removeEventListener('lostpointercapture', this._onLostPointerCapture);
    this._eventWindow?.removeEventListener('blur', this._onWindowBlur);
    this._eventDocument?.removeEventListener('visibilitychange', this._onVisibilityChange);
    disposeObjects(this._contentGroups(), { materials: false });
    disposeObjects([this.gridHelper, this.originAxes]);
    this._disposeMaterialCache();
    for (const material of this._highlightMaterials.values()) material.dispose();
    this._highlightMaterials.clear();
    this._baseMaterials.clear();
    this._visuals.clear();
    this._selection.clear();
    this._pickPointers.clear();
    this._pickGesture = null;
    this._index = null;
    this._levelZMm = this._maxBeamHMByLevel = this._nodeLevelId = null;
    this.scene?.clear();
    for (const group of this._contentGroups()) group.clear();
    this.renderer?.dispose();
    canvas?.remove();
    this.onPick = null;
    this._initialized = false;
  }

  applyTheme() {
    if (!this._initialized) return;
    const style = getComputedStyle(document.documentElement);
    const theme = document.documentElement.dataset.theme || 'dark';
    const bg = style.getPropertyValue('--viewer-bg').trim();
    const g1 = style.getPropertyValue('--viewer-grid1').trim();
    const g2 = style.getPropertyValue('--viewer-grid2').trim();
    this.scene.background = new THREE.Color(bg);

    if (this.renderer) {
      this.renderer.toneMappingExposure = theme === 'light' ? 0.95 : 1.0;
    }
    if (this.ambientLight) {
      this.ambientLight.intensity = theme === 'light' ? 0.72 : 0.5;
    }
    if (this.directionalLight) {
      this.directionalLight.intensity = theme === 'light' ? 0.95 : 0.8;
      this.directionalLight.position.set(
        theme === 'light' ? 12 : 10,
        theme === 'light' ? 22 : 20,
        theme === 'light' ? 14 : 10
      );
    }

    if (this.gridHelper) {
      this.scene.remove(this.gridHelper);
      this.gridHelper.geometry?.dispose();
      const mats = Array.isArray(this.gridHelper.material)
        ? this.gridHelper.material
        : [this.gridHelper.material];
      for (const mat of mats) mat?.dispose?.();
    }
    this.gridHelper = new THREE.GridHelper(50, 50, new THREE.Color(g1), new THREE.Color(g2));
    const gridMats = Array.isArray(this.gridHelper.material)
      ? this.gridHelper.material
      : [this.gridHelper.material];
    for (const mat of gridMats) {
      mat.transparent = true;
      mat.opacity = theme === 'light' ? 0.72 : 0.48;
      mat.depthWrite = false;
    }
    this.scene.add(this.gridHelper);
    this.requestRender();
  }
}
