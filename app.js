/* ============================================================
   Visor BIM IFC - 100% estatico (file://, sin servidor, sin CDN)
   Dependencias locales cargadas como scripts clasicos:
     vendor/three.js              -> window.THREE
     vendor/OrbitControls.js      -> THREE.OrbitControls
     vendor/web-ifc-api-iife.js   -> window.WebIFC   (web-ifc 0.0.78)
     vendor/web-ifc-wasm-b64.js   -> window.__WEB_IFC_WASM_B64
   ============================================================ */
(function () {
  'use strict';

  // ---------- Identidad de la aplicacion ----------
  var APP_VERSION = 'v1.0.0';
  var STORAGE_KEYS = { plan: 'estrukta.plan.v1', bg: 'estrukta.bg.v1' };

  var VIEW_LABELS = {
    regular: 'Regular',
    iso: 'Isométrico',
    front: 'Frente',
    side: 'Costado',
    top: 'Superior'
  };

  var DEFAULT_PLAN_DATA = {
    proyecto: '',
    cliente: '',
    ubicacion: '',
    titulo: '',
    numero: '',
    escala: 'S/E',
    fecha: '',
    revision: '0',
    dibujo: 'Omar Castillo',
    reviso: '',
    lamina: '1 de 1',
    notas: ''
  };

  var PLAN_FIELDS = {
    proyecto: { input: 'field-proyecto', sheet: 'sheet-proyecto' },
    cliente: { input: 'field-cliente', sheet: 'sheet-cliente' },
    ubicacion: { input: 'field-ubicacion', sheet: 'sheet-ubicacion' },
    titulo: { input: 'field-titulo', sheet: 'sheet-titulo' },
    numero: { input: 'field-numero', sheet: 'sheet-numero' },
    escala: { input: 'field-escala', sheet: 'sheet-escala' },
    fecha: { input: 'field-fecha', sheet: 'sheet-fecha' },
    revision: { input: 'field-revision', sheet: 'sheet-revision' },
    dibujo: { input: 'field-dibujo', sheet: 'sheet-dibujo' },
    reviso: { input: 'field-reviso', sheet: 'sheet-reviso' },
    lamina: { input: 'field-lamina', sheet: 'sheet-lamina' },
    notas: { input: 'field-notas', sheet: 'sheet-notas' }
  };

  // ---------- Estado global de la aplicacion ----------
  var state = {
    scene: null,
    camera: null,
    perspCamera: null,
    orthoCamera: null,
    perspControls: null,
    orthoControls: null,
    controls: null,
    projection: 'persp',
    raycaster: null,
    pointer: new THREE.Vector2(),
    api: null,
    modelID: -1,
    meshes: [],
    selected: null,
    isLoaded: false,
    modelBounds: null,
    viewName: 'regular',
    background: '#0f172a',
    displayMode: 'normal',
    lineFillMaterial: null,
    section: { enabled: false, axis: 'y', offset: 50, flip: false, plane: null },
    planData: null
  };

  // ---------- Referencias al DOM ----------
  var els = {
    status: document.getElementById('status'),
    input: document.getElementById('ifc-input'),
    container: document.getElementById('canvas-container'),
    empty: document.getElementById('empty-state'),
    infoPanel: document.getElementById('info-panel'),
    infoTitle: document.getElementById('info-title'),
    infoContent: document.getElementById('info-content'),
    closeInfo: document.getElementById('close-info'),
    loading: document.getElementById('loading-overlay'),
    loadingText: document.getElementById('loading-text'),
    btnAbout: document.getElementById('btn-about'),
    btnPrint: document.getElementById('btn-print'),
    aboutModal: document.getElementById('about-modal'),
    closeAbout: document.getElementById('close-about'),
    printImage: document.getElementById('print-image'),
    printDate: document.getElementById('print-date'),
    btnProjection: document.getElementById('btn-projection'),
    btnSection: document.getElementById('btn-section'),
    btnBg: document.getElementById('btn-bg'),
    btnData: document.getElementById('btn-data'),
    sectionPanel: document.getElementById('section-panel'),
    sectionEnabled: document.getElementById('section-enabled'),
    sectionAxis: document.getElementById('section-axis'),
    sectionOffset: document.getElementById('section-offset'),
    sectionOffsetLabel: document.getElementById('section-offset-label'),
    sectionFlip: document.getElementById('section-flip'),
    btnSectionView: document.getElementById('btn-section-view'),
    bgPopover: document.getElementById('bg-popover'),
    bgColor: document.getElementById('bg-color'),
    btnMode: document.getElementById('btn-mode'),
    modePopover: document.getElementById('mode-popover'),
    dataModal: document.getElementById('data-modal'),
    closeData: document.getElementById('close-data'),
    cancelData: document.getElementById('cancel-data'),
    saveData: document.getElementById('save-data')
  };

  // ---------- Utilidades de interfaz ----------
  function setStatus(text) {
    els.status.textContent = text;
  }

  function showLoading(show, text) {
    if (text) els.loadingText.textContent = text;
    els.loading.classList.toggle('hidden', !show);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function unwrapValue(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && 'value' in value) return String(value.value);
    return '';
  }

  function base64ToBytes(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function byId(id) {
    return document.getElementById(id);
  }

  // ---------- Escena Three.js ----------
  function initThree() {
    var container = els.container;

    state.scene = new THREE.Scene();
    state.background = loadStoredBackground();
    state.scene.background = new THREE.Color(state.background);

    var aspect = container.clientWidth / Math.max(container.clientHeight, 1);

    state.perspCamera = new THREE.PerspectiveCamera(60, aspect, 0.1, 5000);
    state.perspCamera.position.set(8, 8, 8);
    state.perspCamera.up.set(0, 1, 0);

    state.orthoCamera = new THREE.OrthographicCamera(
      -5 * aspect, 5 * aspect, 5, -5, 0.01, 10000
    );
    state.orthoCamera.position.set(8, 8, 8);
    state.orthoCamera.up.set(0, 1, 0);

    state.camera = state.perspCamera;

    state.renderer = new THREE.WebGLRenderer({
      antialias: true,
      logarithmicDepthBuffer: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance'
    });
    state.renderer.setSize(container.clientWidth, container.clientHeight);
    state.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(state.renderer.domElement);

    state.perspControls = new THREE.OrbitControls(state.perspCamera, state.renderer.domElement);
    state.orthoControls = new THREE.OrbitControls(state.orthoCamera, state.renderer.domElement);
    configureControls(state.perspControls);
    configureControls(state.orthoControls);
    state.orthoControls.enabled = false;
    state.controls = state.perspControls;

    // Iluminacion basica
    state.scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    state.scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 0.55));

    var keyLight = new THREE.DirectionalLight(0xffffff, 1.15);
    keyLight.position.set(10, 20, 12);
    state.scene.add(keyLight);

    var fillLight = new THREE.DirectionalLight(0xffffff, 0.35);
    fillLight.position.set(-12, 6, -10);
    state.scene.add(fillLight);

    state.raycaster = new THREE.Raycaster();

    window.addEventListener('resize', onResize);

    var downX = 0;
    var downY = 0;
    var canvas = state.renderer.domElement;
    canvas.addEventListener('pointerdown', function (e) {
      downX = e.clientX;
      downY = e.clientY;
    });
    canvas.addEventListener('click', function (e) {
      if (Math.abs(e.clientX - downX) > 4 || Math.abs(e.clientY - downY) > 4) return;
      onCanvasClick(e);
    });

    els.closeInfo.addEventListener('click', function () {
      selectMesh(null);
    });
  }

  function configureControls(controls) {
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
  }

  function onResize() {
    if (!state.renderer) return;
    var w = els.container.clientWidth;
    var h = els.container.clientHeight;
    state.perspCamera.aspect = w / Math.max(h, 1);
    state.perspCamera.updateProjectionMatrix();
    updateOrthoFrustum(false);
    state.renderer.setSize(w, h);
  }

  // ---------- Camaras, vistas y encuadre ----------
  function updateModelBounds() {
    if (!state.meshes.length) {
      state.modelBounds = null;
      return;
    }
    var box = new THREE.Box3();
    for (var i = 0; i < state.meshes.length; i++) {
      box.expandByObject(state.meshes[i]);
    }
    state.modelBounds = box.isEmpty() ? null : box;
  }

  function getModelCenter() {
    if (state.modelBounds) return state.modelBounds.getCenter(new THREE.Vector3());
    return new THREE.Vector3();
  }

  function getModelRadius() {
    if (!state.modelBounds) return 5;
    var size = state.modelBounds.getSize(new THREE.Vector3());
    var radius = 0.5 * Math.sqrt(size.x * size.x + size.y * size.y + size.z * size.z);
    return radius > 0.001 ? radius : 1;
  }

  function getViewExtents(name) {
    if (!state.modelBounds) return { w: 10, h: 10 };
    var size = state.modelBounds.getSize(new THREE.Vector3());
    // En la escena, Y es la vertical (el modelo carga Y-up).
    if (name === 'front') return { w: size.x, h: size.y };
    if (name === 'side') return { w: size.z, h: size.y };
    if (name === 'top') return { w: size.x, h: size.z };
    var diameter = getModelRadius() * 2;
    return { w: diameter, h: diameter };
  }

  function applyOrthoFrustum(width, height, aspect, resetZoom) {
    var cam = state.orthoCamera;
    if (!cam) return;
    var halfHeight = Math.max(height / 2, (width / 2) / aspect) * 1.12;
    var halfWidth = halfHeight * aspect;
    cam.left = -halfWidth;
    cam.right = halfWidth;
    cam.top = halfHeight;
    cam.bottom = -halfHeight;
    if (resetZoom) cam.zoom = 1;
    cam.updateProjectionMatrix();
  }

  function updateOrthoFrustum(resetZoom) {
    if (!state.orthoCamera) return;
    var w = els.container.clientWidth || 1;
    var h = els.container.clientHeight || 1;
    var aspect = w / Math.max(h, 1);
    var extents = getViewExtents(state.viewName);
    applyOrthoFrustum(extents.w, extents.h, aspect, resetZoom);
  }

  function updateProjectionButton() {
    if (!els.btnProjection) return;
    els.btnProjection.textContent = state.projection === 'ortho' ? 'Orto' : 'Persp';
    els.btnProjection.classList.toggle('active', state.projection === 'ortho');
  }

  function setProjection(mode) {
    if (!state.perspCamera || !state.orthoCamera) return;
    if (mode !== 'ortho') mode = 'persp';
    if (mode === state.projection) {
      updateProjectionButton();
      return;
    }

    var target = state.controls ? state.controls.target.clone() : getModelCenter();
    var up = state.camera ? state.camera.up.clone() : new THREE.Vector3(0, 0, 1);

    if (state.controls) state.controls.enabled = false;
    state.projection = mode;
    state.camera = mode === 'ortho' ? state.orthoCamera : state.perspCamera;
    state.controls = mode === 'ortho' ? state.orthoControls : state.perspControls;
    state.camera.up.copy(up);
    state.controls.target.copy(target);
    state.controls.enabled = true;
    updateProjectionButton();
  }

  function setView(name) {
    state.viewName = VIEW_LABELS[name] ? name : 'regular';

    if (!state.modelBounds) {
      updateToolbarActive();
      updateSheet();
      return;
    }

    var center = getModelCenter();
    var radius = getModelRadius();
    var size = state.modelBounds.getSize(new THREE.Vector3());
    var cam = state.camera;
    var aspect = (els.container.clientWidth || 1) / Math.max(els.container.clientHeight || 1, 1);

    // La escena es Y-up: el eje Y es la vertical y las vistas se construyen
    // con ese convenio (Y hacia arriba).
    var frames = {
      regular: { dir: new THREE.Vector3(1, 0.85, -1).normalize(), up: new THREE.Vector3(0, 1, 0) },
      iso: { dir: new THREE.Vector3(1, 1, -1).normalize(), up: new THREE.Vector3(0, 1, 0) },
      front: { dir: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, 1, 0) },
      side: { dir: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0) },
      top: { dir: new THREE.Vector3(0, 1, 0), up: new THREE.Vector3(0, 0, 1) }
    };
    var frame = frames[state.viewName] || frames.regular;
    cam.up.copy(frame.up);

    var distance;
    if (state.viewName === 'regular') {
      if (state.projection === 'ortho') {
        // Regular en ortografica: vista axonometrica valida (nada de cam.fov,
        // que no existe en OrthographicCamera).
        applyOrthoFrustum(radius * 2, radius * 2, aspect, true);
        distance = radius * 4 + 1;
      } else {
        // Encuadre historico de la app original (vista por defecto).
        var maxDim = Math.max(size.x, size.y, size.z) || 1;
        var fovRegular = cam.fov * Math.PI / 180;
        distance = (maxDim / (2 * Math.tan(fovRegular / 2))) * 1.6;
      }
    } else {
      var extents = getViewExtents(state.viewName);
      if (state.projection === 'ortho') {
        applyOrthoFrustum(extents.w, extents.h, aspect, true);
        distance = radius * 4 + 1;
      } else {
        var vFov = cam.fov * Math.PI / 180;
        var hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
        var distanceHeight = (extents.h / 2) / Math.tan(vFov / 2);
        var distanceWidth = (extents.w / 2) / Math.tan(hFov / 2);
        distance = Math.max(distanceHeight, distanceWidth) * 1.12;
      }
    }

    cam.position.copy(center).addScaledVector(frame.dir, distance);
    cam.near = Math.max(radius / 500, 0.01);
    cam.far = distance + radius * 4 + 10;
    cam.updateProjectionMatrix();

    state.controls.target.copy(center);
    if (state.projection === 'ortho') {
      state.controls.minZoom = 0.05;
      state.controls.maxZoom = 50;
    } else {
      state.controls.minDistance = radius * 0.02;
      state.controls.maxDistance = radius * 50;
    }
    state.controls.update();

    updateToolbarActive();
    updateSheet();
  }

  function updateToolbarActive() {
    var buttons = document.querySelectorAll('#view-toolbar [data-view]');
    for (var i = 0; i < buttons.length; i++) {
      var view = buttons[i].getAttribute('data-view');
      buttons[i].classList.toggle('active', view === state.viewName);
    }
  }

  // ---------- Plano de corte ----------
  function updateSectionPlane() {
    if (!state.renderer) return;
    var section = state.section;

    if (!section.enabled || !state.modelBounds) {
      state.renderer.clippingPlanes = [];
      section.plane = null;
      updateSheet();
      return;
    }

    var box = state.modelBounds;
    var axis = section.axis;
    var min = box.min[axis];
    var max = box.max[axis];
    var position = min + (max - min) * (section.offset / 100);

    var normal = new THREE.Vector3(
      axis === 'x' ? 1 : 0,
      axis === 'y' ? 1 : 0,
      axis === 'z' ? 1 : 0
    );
    if (section.flip) normal.negate();

    var point = new THREE.Vector3(
      axis === 'x' ? position : 0,
      axis === 'y' ? position : 0,
      axis === 'z' ? position : 0
    );
    var constant = -normal.dot(point);

    section.plane = new THREE.Plane(normal, constant);
    state.renderer.clippingPlanes = [section.plane];
    updateSheet();
  }

  function setSectionView() {
    if (!state.modelBounds) return;
    state.section.enabled = true;
    if (els.sectionEnabled) els.sectionEnabled.checked = true;
    updateSectionPlane();
    setProjection('ortho');
    // Y-up: un corte horizontal (Y) se ve como planta.
    var map = { x: 'side', y: 'top', z: 'front' };
    setView(map[state.section.axis] || 'regular');
  }

  // ---------- Fondo ----------
  function loadStoredBackground() {
    try {
      var saved = localStorage.getItem(STORAGE_KEYS.bg);
      if (saved && /^#[0-9a-fA-F]{6}$/.test(saved)) return saved;
    } catch (ignored) { /* noop */ }
    return '#0f172a';
  }

  function setBackground(hex) {
    if (!hex) return;
    state.background = hex;
    if (state.scene) state.scene.background = new THREE.Color(hex);
    if (els.bgColor) els.bgColor.value = hex;

    var swatches = document.querySelectorAll('.bg-swatch');
    for (var i = 0; i < swatches.length; i++) {
      var color = (swatches[i].getAttribute('data-color') || '').toLowerCase();
      swatches[i].classList.toggle('active', color === hex.toLowerCase());
    }

    try { localStorage.setItem(STORAGE_KEYS.bg, hex); } catch (ignored) { /* noop */ }

    // En modo lineas el relleno y las aristas dependen del fondo.
    if (state.displayMode === 'lines' && state.meshes.length) applyLineMode();
  }

  // ---------- Modos de visualizacion ----------
  function backgroundLightness() {
    var bg = state.scene && state.scene.background;
    if (bg && bg.isColor) {
      var hsl = { h: 0, s: 0, l: 0 };
      bg.getHSL(hsl);
      return hsl.l;
    }
    return 0;
  }

  function lineContrastColor() {
    return backgroundLightness() > 0.55 ? 0x0f172a : 0xffffff;
  }

  function ensureLineFillMaterial() {
    if (!state.lineFillMaterial) {
      state.lineFillMaterial = new THREE.MeshBasicMaterial({
        color: 0x0f172a,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1
      });
    }
  }

  function ensureEdges(mesh) {
    if (mesh.userData.edges) return mesh.userData.edges;
    var edgeGeometry = new THREE.EdgesGeometry(mesh.geometry, 30);
    var edgeMaterial = new THREE.LineBasicMaterial({ color: lineContrastColor() });
    var edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    edges.frustumCulled = false;
    mesh.add(edges);
    mesh.userData.edges = edges;
    mesh.userData.edgeGeometry = edgeGeometry;
    mesh.userData.edgeMaterial = edgeMaterial;
    return edges;
  }

  function disposeEdges(mesh) {
    var edges = mesh.userData && mesh.userData.edges;
    if (!edges) return;
    mesh.remove(edges);
    if (mesh.userData.edgeGeometry) mesh.userData.edgeGeometry.dispose();
    if (mesh.userData.edgeMaterial) mesh.userData.edgeMaterial.dispose();
    mesh.userData.edges = null;
    mesh.userData.edgeGeometry = null;
    mesh.userData.edgeMaterial = null;
  }

  function setAllEdgeColors(hex) {
    for (var i = 0; i < state.meshes.length; i++) {
      var mat = state.meshes[i].userData.edgeMaterial;
      if (mat) mat.color.setHex(hex);
    }
  }

  function restoreMeshMaterials() {
    for (var i = 0; i < state.meshes.length; i++) {
      var mesh = state.meshes[i];
      if (mesh.userData.savedMaterial) {
        mesh.material = mesh.userData.savedMaterial;
        mesh.userData.savedMaterial = null;
      }
      var material = mesh.material;
      if (material) {
        var base = material.userData && material.userData.baseColor;
        if (base && material.color) material.color.copy(base);
        if (material.emissive) material.emissive.setHex(0x000000);
        material.transparent = false;
        material.opacity = 1;
        material.depthWrite = true;
        material.wireframe = false;
        material.needsUpdate = true;
      }
      if (mesh.userData.edges) mesh.userData.edges.visible = false;
    }
  }

  function applyLineMode() {
    ensureLineFillMaterial();
    var bgHex = (state.scene.background && state.scene.background.isColor)
      ? state.scene.background.getHex()
      : 0x0f172a;
    var edgeHex = lineContrastColor();

    state.lineFillMaterial.color.setHex(bgHex);

    for (var i = 0; i < state.meshes.length; i++) {
      var mesh = state.meshes[i];
      var edges = ensureEdges(mesh);
      edges.visible = true;
      if (mesh.userData.edgeMaterial) mesh.userData.edgeMaterial.color.setHex(edgeHex);
      if (!mesh.userData.savedMaterial) mesh.userData.savedMaterial = mesh.material;
      mesh.material = state.lineFillMaterial;
    }

    if (state.selected && state.selected.userData.edgeMaterial) {
      state.selected.userData.edgeMaterial.color.setHex(0x38bdf8);
    }
  }

  function applyGrayscale() {
    for (var i = 0; i < state.meshes.length; i++) {
      var material = state.meshes[i].material;
      if (!material || !material.color) continue;
      var base = (material.userData && material.userData.baseColor) || material.color;
      var luminance = 0.2126 * base.r + 0.7152 * base.g + 0.0722 * base.b;
      material.color.setScalar(luminance);
      material.transparent = false;
      material.opacity = 1;
      material.depthWrite = true;
      material.wireframe = false;
      material.needsUpdate = true;
    }
  }

  function applyXray() {
    for (var i = 0; i < state.meshes.length; i++) {
      var material = state.meshes[i].material;
      if (!material) continue;
      if (material.color) material.color.setHex(0x38bdf8);
      material.transparent = true;
      material.opacity = 0.18;
      material.depthWrite = false;
      material.wireframe = false;
      material.needsUpdate = true;
    }
  }

  function updateModeUI() {
    var labels = { normal: 'Modo', lines: 'Líneas', grayscale: 'Grises', xray: 'Rayos X' };
    if (els.btnMode) {
      els.btnMode.textContent = labels[state.displayMode] || 'Modo';
      els.btnMode.classList.toggle('active', state.displayMode !== 'normal');
    }
    var options = document.querySelectorAll('.mode-option');
    for (var i = 0; i < options.length; i++) {
      options[i].classList.toggle('active', options[i].getAttribute('data-mode') === state.displayMode);
    }
  }

  function setDisplayMode(mode) {
    if (mode !== 'lines' && mode !== 'grayscale' && mode !== 'xray') mode = 'normal';
    state.displayMode = mode;

    restoreMeshMaterials();

    if (mode === 'lines') {
      applyLineMode();
    } else if (mode === 'grayscale') {
      applyGrayscale();
    } else if (mode === 'xray') {
      applyXray();
    }

    // Mantener resaltado de la seleccion en el modo activo.
    if (state.selected) {
      if (mode === 'lines') {
        if (state.selected.userData.edgeMaterial) {
          state.selected.userData.edgeMaterial.color.setHex(0x38bdf8);
        }
      } else if (state.selected.material && state.selected.material.emissive) {
        state.selected.material.emissive.setHex(0x17395f);
      }
    }

    updateModeUI();
    render();
  }

  // ---------- Datos del plano ----------
  function initPlanData() {
    var data = {};
    for (var key in DEFAULT_PLAN_DATA) data[key] = DEFAULT_PLAN_DATA[key];
    try {
      data.fecha = new Date().toLocaleDateString('es-MX');
    } catch (ignored) {
      data.fecha = '';
    }

    try {
      var raw = localStorage.getItem(STORAGE_KEYS.plan);
      if (raw) {
        var saved = JSON.parse(raw);
        if (saved && typeof saved === 'object') {
          for (var field in data) {
            if (typeof saved[field] === 'string') data[field] = saved[field];
          }
        }
      }
    } catch (ignored) { /* noop */ }

    state.planData = data;
  }

  function writePlanForm() {
    for (var key in PLAN_FIELDS) {
      var el = byId(PLAN_FIELDS[key].input);
      if (el) el.value = state.planData[key] || '';
    }
  }

  function readPlanForm() {
    for (var key in PLAN_FIELDS) {
      var el = byId(PLAN_FIELDS[key].input);
      if (el) state.planData[key] = el.value;
    }
  }

  function persistPlanData() {
    try { localStorage.setItem(STORAGE_KEYS.plan, JSON.stringify(state.planData)); } catch (ignored) { /* noop */ }
  }

  function getViewLabel() {
    var label = VIEW_LABELS[state.viewName] || VIEW_LABELS.regular;
    if (state.section.enabled) {
      label += ' · Corte ' + state.section.axis.toUpperCase();
    }
    return label;
  }

  function updateSheet() {
    if (!state.planData) return;
    for (var key in PLAN_FIELDS) {
      var el = byId(PLAN_FIELDS[key].sheet);
      if (el) el.textContent = state.planData[key] || '';
    }
    var viewEl = byId('sheet-view-name');
    if (viewEl) viewEl.textContent = getViewLabel();
  }

  function showDataModal(show) {
    if (!els.dataModal) return;
    if (show) writePlanForm();
    els.dataModal.classList.toggle('hidden', !show);
  }

  function togglePanel(panel) {
    if (!panel) return;
    var willShow = panel.classList.contains('hidden');
    var panels = [els.sectionPanel, els.bgPopover, els.modePopover];
    for (var i = 0; i < panels.length; i++) {
      if (panels[i] && panels[i] !== panel) panels[i].classList.add('hidden');
    }
    panel.classList.toggle('hidden', !willShow);
  }

  // ---------- Identidad, Acerca de e impresion ----------
  function bindChrome() {
    var versionNodes = document.querySelectorAll('[data-app-version]');
    for (var i = 0; i < versionNodes.length; i++) {
      versionNodes[i].textContent = APP_VERSION;
    }

    if (els.btnAbout) {
      els.btnAbout.addEventListener('click', function () { showAbout(true); });
    }
    if (els.closeAbout) {
      els.closeAbout.addEventListener('click', function () { showAbout(false); });
    }
    if (els.aboutModal) {
      els.aboutModal.addEventListener('click', function (e) {
        if (e.target === els.aboutModal) showAbout(false);
      });
    }

    if (els.btnPrint) els.btnPrint.addEventListener('click', printCurrentView);
    window.addEventListener('beforeprint', beforePrint);
    window.addEventListener('afterprint', cleanupPrint);

    // Vistas
    var viewButtons = document.querySelectorAll('#view-toolbar [data-view]');
    for (var v = 0; v < viewButtons.length; v++) {
      viewButtons[v].addEventListener('click', function () {
        if (!state.modelBounds) return;
        var view = this.getAttribute('data-view');
        // "Regular" restaura la vista original en perspectiva.
        if (view === 'regular') setProjection('persp');
        setView(view);
      });
    }

    if (els.btnProjection) {
      els.btnProjection.addEventListener('click', function () {
        setProjection(state.projection === 'ortho' ? 'persp' : 'ortho');
        setView(state.viewName);
      });
    }

    // Panel de seccion
    if (els.btnSection) {
      els.btnSection.addEventListener('click', function () { togglePanel(els.sectionPanel); });
    }
    if (els.sectionEnabled) {
      els.sectionEnabled.addEventListener('change', function () {
        state.section.enabled = this.checked;
        updateSectionPlane();
      });
    }
    if (els.sectionAxis) {
      els.sectionAxis.addEventListener('change', function () {
        state.section.axis = this.value;
        updateSectionPlane();
      });
    }
    if (els.sectionOffset) {
      els.sectionOffset.addEventListener('input', function () {
        state.section.offset = Number(this.value);
        if (els.sectionOffsetLabel) els.sectionOffsetLabel.textContent = this.value + '%';
        updateSectionPlane();
      });
    }
    if (els.sectionFlip) {
      els.sectionFlip.addEventListener('change', function () {
        state.section.flip = this.checked;
        updateSectionPlane();
      });
    }
    if (els.btnSectionView) els.btnSectionView.addEventListener('click', setSectionView);

    // Fondo
    if (els.btnBg) {
      els.btnBg.addEventListener('click', function (e) {
        e.stopPropagation();
        togglePanel(els.bgPopover);
      });
    }
    var swatches = document.querySelectorAll('.bg-swatch');
    for (var s = 0; s < swatches.length; s++) {
      swatches[s].addEventListener('click', function () {
        setBackground(this.getAttribute('data-color'));
      });
    }
    if (els.bgColor) {
      els.bgColor.addEventListener('input', function () { setBackground(this.value); });
    }
    document.addEventListener('click', function (e) {
      if (!els.bgPopover || els.bgPopover.classList.contains('hidden')) return;
      if (els.bgPopover.contains(e.target) || (els.btnBg && els.btnBg.contains(e.target))) return;
      els.bgPopover.classList.add('hidden');
    });

    // Modo de visualizacion
    if (els.btnMode) {
      els.btnMode.addEventListener('click', function (e) {
        e.stopPropagation();
        togglePanel(els.modePopover);
      });
    }
    var modeOptions = document.querySelectorAll('.mode-option');
    for (var m = 0; m < modeOptions.length; m++) {
      modeOptions[m].addEventListener('click', function () {
        setDisplayMode(this.getAttribute('data-mode'));
        if (els.modePopover) els.modePopover.classList.add('hidden');
      });
    }
    document.addEventListener('click', function (e) {
      if (!els.modePopover || els.modePopover.classList.contains('hidden')) return;
      if (els.modePopover.contains(e.target) || (els.btnMode && els.btnMode.contains(e.target))) return;
      els.modePopover.classList.add('hidden');
    });

    // Datos del plano
    if (els.btnData) els.btnData.addEventListener('click', function () { showDataModal(true); });
    if (els.closeData) els.closeData.addEventListener('click', function () { showDataModal(false); });
    if (els.cancelData) els.cancelData.addEventListener('click', function () { showDataModal(false); });
    if (els.dataModal) {
      els.dataModal.addEventListener('click', function (e) {
        if (e.target === els.dataModal) showDataModal(false);
      });
    }
    if (els.saveData) {
      els.saveData.addEventListener('click', function () {
        readPlanForm();
        persistPlanData();
        updateSheet();
        showDataModal(false);
      });
    }

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      showAbout(false);
      showDataModal(false);
      if (els.sectionPanel) els.sectionPanel.classList.add('hidden');
      if (els.bgPopover) els.bgPopover.classList.add('hidden');
      if (els.modePopover) els.modePopover.classList.add('hidden');
    });

    updateProjectionButton();
    updateToolbarActive();
    updateModeUI();
  }

  function formatPrintDate() {
    try {
      return new Date().toLocaleString('es-MX', {
        dateStyle: 'medium',
        timeStyle: 'short'
      });
    } catch (ignored) {
      return new Date().toLocaleString();
    }
  }

  function beforePrint() {
    if (els.printDate) els.printDate.textContent = formatPrintDate();
    updateSheet();
    // Si el usuario imprime con Ctrl+P (sin pasar por el boton), capturar
    // tambien la vista actual.
    if (state.isLoaded && els.printImage && !els.printImage.getAttribute('src')) {
      try {
        els.printImage.src = captureCurrentView();
      } catch (ignored) { /* noop */ }
    }
  }

  function showAbout(show) {
    if (!els.aboutModal) return;
    els.aboutModal.classList.toggle('hidden', !show);
  }

  function setPrintEnabled(enabled) {
    if (els.btnPrint) els.btnPrint.disabled = !enabled;
  }

  function captureCurrentView() {
    // El PDF/impresion usa fondo blanco; se restaura el fondo en pantalla.
    var previous = state.scene.background;
    var lineMode = state.displayMode === 'lines' && state.lineFillMaterial;
    var previousFill = null;
    var previousEdges = null;

    if (lineMode) {
      // En papel: relleno blanco y aristas negras.
      previousFill = state.lineFillMaterial.color.getHex();
      previousEdges = lineContrastColor();
      state.lineFillMaterial.color.setHex(0xffffff);
      setAllEdgeColors(0x0f172a);
    }

    state.scene.background = new THREE.Color(0xffffff);
    state.renderer.render(state.scene, state.camera);

    var dataUrl;
    try {
      dataUrl = state.renderer.domElement.toDataURL('image/png');
    } finally {
      state.scene.background = previous;
      if (lineMode) {
        state.lineFillMaterial.color.setHex(previousFill);
        setAllEdgeColors(previousEdges);
        if (state.selected && state.selected.userData.edgeMaterial) {
          state.selected.userData.edgeMaterial.color.setHex(0x38bdf8);
        }
      }
      state.renderer.render(state.scene, state.camera);
    }
    return dataUrl;
  }

  function printCurrentView() {
    if (!state.isLoaded || !state.renderer || !state.scene || !state.camera) return;

    updateSheet();

    var dataUrl;
    try {
      dataUrl = captureCurrentView();
    } catch (err) {
      console.warn('No se pudo capturar la vista para imprimir', err);
      alert('No se pudo preparar la impresión.');
      return;
    }

    if (els.printDate) els.printDate.textContent = formatPrintDate();

    // Esperar a que la imagen este lista antes de abrir el dialogo, si no
    // la vista previa puede salir en blanco.
    els.printImage.removeAttribute('src');
    els.printImage.onload = function () {
      els.printImage.onload = null;
      els.printImage.onerror = null;
      window.print();
    };
    els.printImage.onerror = function () {
      els.printImage.onload = null;
      els.printImage.onerror = null;
      els.printImage.removeAttribute('src');
      alert('No se pudo preparar la impresión.');
    };
    els.printImage.src = dataUrl;
  }

  function cleanupPrint() {
    if (els.printImage) els.printImage.removeAttribute('src');
  }

  // ---------- Motor web-ifc (WASM embebido en Base64) ----------
  async function initIFC() {
    if (state.api) return state.api;

    var b64 = window.__WEB_IFC_WASM_B64;
    if (!b64) throw new Error('Falta vendor/web-ifc-wasm-b64.js');

    // 1) data: URL -> no hace ninguna peticion de red ni de archivo
    try {
      var api = new WebIFC.IfcAPI();
      var dataUrl = 'data:application/wasm;base64,' + b64;
      await api.Init(function () { return dataUrl; }, true);
      state.api = api;
      return api;
    } catch (firstError) {
      console.warn('Init con data: URL fallo, reintentando con Blob URL...', firstError);
    }

    // 2) Respaldo: Blob URL (tambien local, sin red)
    var bytes = base64ToBytes(b64);
    var blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/wasm' }));
    var api2 = new WebIFC.IfcAPI();
    await api2.Init(function () { return blobUrl; }, true);
    state.api = api2;
    return api2;
  }

  // ---------- Carga de archivo IFC ----------
  function bindFileInput() {
    els.input.addEventListener('change', async function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;

      setStatus('Cargando...');
      showLoading(true, 'Iniciando motor IFC...');

      try {
        var api = await initIFC();

        showLoading(true, 'Leyendo archivo...');
        var buffer = await file.arrayBuffer();

        if (state.modelID >= 0) {
          clearModel();
          try { api.CloseModel(state.modelID); } catch (ignored) { /* noop */ }
          state.modelID = -1;
        }

        showLoading(true, 'Procesando IFC...');
        var modelID = api.OpenModel(new Uint8Array(buffer), {
          COORDINATE_TO_ORIGIN: true,
          CIRCLE_SEGMENTS: 16
        });
        if (modelID < 0) {
          throw new Error('No se pudo interpretar el IFC (esquema no soportado).');
        }
        state.modelID = modelID;

        showLoading(true, 'Generando geometria...');
        buildGeometry(modelID);

        if (!state.meshes.length) {
          throw new Error('El modelo no contiene geometria visible.');
        }

        state.isLoaded = true;
        setPrintEnabled(true);
        els.empty.classList.add('hidden');
        updateModelBounds();
        updateSectionPlane();
        setProjection('persp');
        setView('regular');
        setDisplayMode(state.displayMode);
        setStatus('Listo - ' + state.meshes.length + ' elementos');
        showLoading(false);
        render();
      } catch (err) {
        console.error(err);
        showLoading(false);
        setStatus('Error');
        alert('No se pudo cargar el IFC:\n' + (err && err.message ? err.message : err));
      } finally {
        els.input.value = '';
      }
    });
  }

  function clearModel() {
    for (var i = 0; i < state.meshes.length; i++) {
      var mesh = state.meshes[i];
      disposeEdges(mesh);
      // Si estaba en modo lineas, el material visible es el compartido:
      // restaurar el original antes de liberar para no liberar el compartido.
      if (mesh.userData.savedMaterial) {
        mesh.material = mesh.userData.savedMaterial;
        mesh.userData.savedMaterial = null;
      }
      state.scene.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) mesh.material.dispose();
    }
    state.meshes = [];
    state.selected = null;
    state.isLoaded = false;
    state.modelBounds = null;

    state.section.enabled = false;
    state.section.plane = null;
    state.section.offset = 50;
    if (state.renderer) state.renderer.clippingPlanes = [];
    if (els.sectionEnabled) els.sectionEnabled.checked = false;
    if (els.sectionOffset) els.sectionOffset.value = '50';
    if (els.sectionOffsetLabel) els.sectionOffsetLabel.textContent = '50%';

    setPrintEnabled(false);
    updateSheet();
  }

  // ---------- Generacion de geometria ----------
  function buildGeometry(modelID) {
    var api = state.api;

    api.StreamAllMeshes(modelID, function (flatMesh) {
      try {
        var expressID = flatMesh.expressID;
        var geometries = flatMesh.geometries;
        var count = geometries.size();

        for (var i = 0; i < count; i++) {
          var placed = geometries.get(i);
          addPlacedGeometry(placed, expressID);
        }
      } catch (err) {
        console.warn('Elemento omitido:', err);
      } finally {
        try { flatMesh.delete(); } catch (ignored) { /* noop */ }
      }
    });
  }

  function addPlacedGeometry(placed, expressID) {
    if (state.modelID < 0) return;
    var api = state.api;
    var geometry = api.GetGeometry(state.modelID, placed.geometryExpressID);

    try {
      // Vertices (puntero al heap WASM -> copiar de inmediato)
      var vertexPtr = geometry.GetVertexData();
      var floatCount = geometry.GetVertexDataSize();
      var raw = new Float32Array(api.wasmModule.HEAPF32.buffer, vertexPtr, floatCount).slice();

      // Indices (copiar de inmediato tambien)
      var indexPtr = geometry.GetIndexData();
      var indexCount = geometry.GetIndexDataSize();
      var indices = new Uint32Array(api.wasmModule.HEAPU32.buffer, indexPtr, indexCount).slice();

      if (floatCount === 0 || indexCount === 0) return;

      // web-ifc 0.0.78 entrega el buffer interleaved como [x,y,z,nx,ny,nz]
      // (6 floats por vertice). Se detecta el stride comparando el tamano del
      // buffer con el mayor indice usado; si no cuadra, se asume solo posicion.
      var maxIndex = 0;
      for (var k = 0; k < indices.length; k++) {
        if (indices[k] > maxIndex) maxIndex = indices[k];
      }
      var vertexTotal = maxIndex + 1;
      var stride = (floatCount === vertexTotal * 6) ? 6 : 3;

      var positions = new Float32Array(vertexTotal * 3);
      var normals = stride === 6 ? new Float32Array(vertexTotal * 3) : null;
      for (var v = 0; v < vertexTotal; v++) {
        var src = v * stride;
        positions[v * 3] = raw[src];
        positions[v * 3 + 1] = raw[src + 1];
        positions[v * 3 + 2] = raw[src + 2];
        if (normals) {
          normals[v * 3] = raw[src + 3];
          normals[v * 3 + 1] = raw[src + 4];
          normals[v * 3 + 2] = raw[src + 5];
        }
      }

      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      if (normals) geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      geo.setIndex(new THREE.BufferAttribute(indices, 1));

      if (placed.flatTransformation) {
        // applyMatrix4 tambien transforma las normales con la normal matrix.
        geo.applyMatrix4(new THREE.Matrix4().fromArray(placed.flatTransformation));
      }

      // Solo si no habia normales embebidas se calculan suavizadas (60 grados).
      if (!normals) {
        geo = THREE.BufferGeometryUtils.toCreasedNormals(geo, Math.PI / 3);
      }

      var c = placed.color || { x: 0.6, y: 0.6, z: 0.6 };
      var color;
      try {
        color = new THREE.Color().setRGB(c.x, c.y, c.z, THREE.SRGBColorSpace);
      } catch (ignored) {
        color = new THREE.Color(c.x, c.y, c.z);
      }

      var material = new THREE.MeshStandardMaterial({
        color: color,
        roughness: 0.7,
        metalness: 0.0,
        side: THREE.DoubleSide
      });
      material.userData.baseColor = color.clone();

      var mesh = new THREE.Mesh(geo, material);
      mesh.userData = { expressID: expressID, savedMaterial: null, edges: null };
      state.scene.add(mesh);
      state.meshes.push(mesh);
    } finally {
      try { geometry.delete(); } catch (ignored) { /* noop */ }
    }
  }

  // ---------- Seleccion por clic ----------
  function onCanvasClick(event) {
    if (!state.isLoaded) return;

    var rect = state.renderer.domElement.getBoundingClientRect();
    state.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    state.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    state.raycaster.setFromCamera(state.pointer, state.camera);
    var hits = state.raycaster.intersectObjects(state.meshes, false);

    if (hits.length > 0) {
      selectMesh(hits[0].object);
    } else {
      selectMesh(null);
    }
  }

  function selectMesh(mesh) {
    if (state.selected) {
      if (state.selected.material && state.selected.material.emissive) {
        state.selected.material.emissive.setHex(0x000000);
      }
      if (state.displayMode === 'lines' && state.selected.userData.edgeMaterial) {
        state.selected.userData.edgeMaterial.color.setHex(lineContrastColor());
      }
    }

    state.selected = mesh || null;

    if (!mesh) {
      els.infoPanel.classList.add('hidden');
      els.infoPanel.classList.remove('visible');
      return;
    }

    if (state.displayMode === 'lines') {
      if (mesh.userData.edgeMaterial) mesh.userData.edgeMaterial.color.setHex(0x38bdf8);
    } else if (mesh.material && mesh.material.emissive) {
      mesh.material.emissive.setHex(0x17395f);
    }

    var info = describeElement(mesh.userData.expressID);
    els.infoTitle.textContent = info.type || 'Elemento IFC';
    els.infoContent.innerHTML =
      '<div class="info-row"><span class="label">ExpressID</span><span class="value">#' + info.expressID + '</span></div>' +
      (info.name ? '<div class="info-row"><span class="label">Nombre</span><span class="value">' + escapeHtml(info.name) + '</span></div>' : '') +
      (info.globalId ? '<div class="info-row"><span class="label">GlobalId</span><span class="value">' + escapeHtml(info.globalId) + '</span></div>' : '') +
      (info.type ? '<div class="info-row"><span class="label">Tipo</span><span class="value">' + escapeHtml(info.type) + '</span></div>' : '');

    els.infoPanel.classList.remove('hidden');
    els.infoPanel.classList.add('visible');
  }

  function describeElement(expressID) {
    var out = { expressID: expressID, type: '', name: '', globalId: '' };
    try {
      var line = state.api.GetLine(state.modelID, expressID, false);
      if (line) {
        if (line.constructor && line.constructor.name) out.type = line.constructor.name;
        else if (typeof line.type === 'string') out.type = line.type;
        out.name = unwrapValue(line.Name);
        out.globalId = unwrapValue(line.GlobalId);
      }
    } catch (err) {
      console.warn('No se pudo leer el elemento', expressID, err);
    }
    return out;
  }

  // ---------- Bucle de render ----------
  function render() {
    if (state.renderer && state.scene && state.camera) {
      state.renderer.render(state.scene, state.camera);
    }
  }

  function animate() {
    requestAnimationFrame(animate);
    if (state.controls) state.controls.update();
    render();
  }

  // ---------- Arranque ----------
  function boot() {
    if (typeof THREE === 'undefined') {
      alert('No se pudo cargar Three.js (vendor/three.js).');
      return;
    }
    if (typeof WebIFC === 'undefined') {
      alert('No se pudo cargar web-ifc (vendor/web-ifc-api-iife.js).');
      return;
    }
    initThree();
    initPlanData();
    bindChrome();
    bindFileInput();
    setBackground(state.background);
    updateSheet();
    animate();
    setStatus('Esperando archivo...');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
