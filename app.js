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

  // ---------- Estado global de la aplicacion ----------
  var state = {
    scene: null,
    camera: null,
    renderer: null,
    controls: null,
    raycaster: null,
    pointer: new THREE.Vector2(),
    api: null,
    modelID: -1,
    meshes: [],
    selected: null,
    isLoaded: false
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
    loadingText: document.getElementById('loading-text')
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

  // ---------- Escena Three.js ----------
  function initThree() {
    var container = els.container;

    state.scene = new THREE.Scene();
    state.scene.background = new THREE.Color(0x0f172a);

    state.camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / container.clientHeight,
      0.1,
      5000
    );
    state.camera.position.set(8, 8, 8);

    state.renderer = new THREE.WebGLRenderer({
      antialias: true,
      logarithmicDepthBuffer: true,
      powerPreference: 'high-performance'
    });
    state.renderer.setSize(container.clientWidth, container.clientHeight);
    state.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(state.renderer.domElement);

    state.controls = new THREE.OrbitControls(state.camera, state.renderer.domElement);
    state.controls.enableDamping = true;
    state.controls.dampingFactor = 0.08;
    state.controls.screenSpacePanning = true;

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

  function onResize() {
    if (!state.renderer) return;
    var w = els.container.clientWidth;
    var h = els.container.clientHeight;
    state.camera.aspect = w / h;
    state.camera.updateProjectionMatrix();
    state.renderer.setSize(w, h);
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
        els.empty.classList.add('hidden');
        fitCamera();
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
      state.scene.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) mesh.material.dispose();
    }
    state.meshes = [];
    state.selected = null;
    state.isLoaded = false;
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

      var mesh = new THREE.Mesh(geo, material);
      mesh.userData = { expressID: expressID };
      state.scene.add(mesh);
      state.meshes.push(mesh);
    } finally {
      try { geometry.delete(); } catch (ignored) { /* noop */ }
    }
  }

  // ---------- Ajuste de camara al modelo ----------
  function fitCamera() {
    if (!state.meshes.length) return;

    var box = new THREE.Box3();
    for (var i = 0; i < state.meshes.length; i++) {
      box.expandByObject(state.meshes[i]);
    }
    if (box.isEmpty()) return;

    var center = box.getCenter(new THREE.Vector3());
    var size = box.getSize(new THREE.Vector3());
    var maxDim = Math.max(size.x, size.y, size.z) || 1;

    var fov = state.camera.fov * Math.PI / 180;
    var distance = (maxDim / (2 * Math.tan(fov / 2))) * 1.6;

    var direction = new THREE.Vector3(1, 0.85, 1).normalize();
    state.camera.position.copy(center).addScaledVector(direction, distance);

    // Precision de profundidad: mantener la relacion far/near baja
    // (evita z-fighting y parches triangulares en caras coplanares).
    var camDist = state.camera.position.distanceTo(center);
    state.camera.near = Math.max(maxDim / 1000, 0.01);
    state.camera.far = camDist + maxDim * 4;
    state.camera.updateProjectionMatrix();

    state.controls.target.copy(center);
    state.controls.minDistance = maxDim * 0.02;
    state.controls.maxDistance = maxDim * 50;
    state.controls.update();
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
    if (state.selected && state.selected.material && state.selected.material.emissive) {
      state.selected.material.emissive.setHex(0x000000);
    }

    state.selected = mesh || null;

    if (!mesh) {
      els.infoPanel.classList.add('hidden');
      els.infoPanel.classList.remove('visible');
      return;
    }

    if (mesh.material && mesh.material.emissive) {
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
    bindFileInput();
    animate();
    setStatus('Esperando archivo...');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
