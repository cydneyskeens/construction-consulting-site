/* ===================================================
 3D MODEL VIEWER
 Parses 3DFACE mesh data straight out of raw DXF text and
 renders it with Three.js. Each model's DXF data now lives in
 its own file under models/<key>.dxf and is loaded with fetch().
 =================================================== */
(function () {
    const wrap = document.getElementById('modelCanvasWrap');
    const select = document.getElementById('modelSelect');
    const loadingEl = document.getElementById('modelLoading');
    const loadingText = document.getElementById('modelLoadingText');
    const errorEl = document.getElementById('modelError');

    if (!wrap || !select || typeof THREE === 'undefined') return;

    /* ---- Minimal DXF 3DFACE / LINE parser ----
       Reads group-code/value pairs. We only need 3DFACE (mesh
       faces) and LINE (edges) — everything else is ignored. */
    function parseDXF(text) {
      // Normalize line endings once up front (fast) instead of matching a
      // multi-alternative regex on every split — meaningfully faster on the
      // larger files (some of these DXFs are 2-3MB+ with 15,000+ 3DFACE
      // entities, which was causing long stalls/hangs on slower devices).
      const lines = text.replace(/\r\n?/g, '\n').split('\n');
      const positions = [];   // triangle vertex positions for 3DFACE mesh
      let inEntities = false;
      let i = 0;

      function readEntity(type) {
        const pt = {
          10: null, 20: null, 30: null, 11: null, 21: null, 31: null,
          12: null, 22: null, 32: null, 13: null, 23: null, 33: null
        };
        let j = i;
        while (j < lines.length - 1) {
          const code = lines[j].trim();
          const val = lines[j + 1] !== undefined ? lines[j + 1].trim() : '';
          if (code === '0') break; // next entity starts
          if (pt.hasOwnProperty(code)) pt[code] = parseFloat(val);
          j += 2;
        }
        i = j;
        return pt;
      }

      while (i < lines.length - 1) {
        const code = lines[i].trim();
        const val = lines[i + 1] !== undefined ? lines[i + 1].trim() : '';

        if (code === '2' && val === 'ENTITIES') { inEntities = true; i += 2; continue; }
        if (code === '0' && inEntities && val === 'ENDSEC') { inEntities = false; i += 2; continue; }

        if (code === '0' && inEntities && val === '3DFACE') {
          i += 2;
          const pt = readEntity('3DFACE');
          if (pt[10] !== null && pt[11] !== null && pt[12] !== null) {
            const v1 = [pt[10], pt[30], -pt[20]];
            const v2 = [pt[11], pt[31], -pt[21]];
            const v3 = [pt[12], pt[32], -pt[22]];
            // triangle 1
            positions.push(...v1, ...v2, ...v3);
            // 4th point present and distinct → second triangle (quad face)
            if (pt[13] !== null && (pt[13] !== pt[12] || pt[23] !== pt[22] || pt[33] !== pt[32])) {
              const v4 = [pt[13], pt[33], -pt[23]];
              positions.push(...v1, ...v3, ...v4);
            }
          }
          continue;
        }

        if (code === '0' && inEntities) {
          i += 2;
          readEntity(val); // skip any other entity type
          continue;
        }

        i += 2;
      }

      return positions;
    }

    /* ---- Three.js scene (created once, reused per model) ---- */
    let renderer, scene, camera, controls, mesh, wireframe;
    let resizeObserver;

    function initScene() {
      scene = new THREE.Scene();

      camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100000);

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      wrap.appendChild(renderer.domElement);

      const hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 1.1);
      scene.add(hemi);
      const dir = new THREE.DirectionalLight(0xffffff, 0.9);
      dir.position.set(1, 1.5, 1);
      scene.add(dir);
      const dir2 = new THREE.DirectionalLight(0xf5b300, 0.35);
      dir2.position.set(-1, 0.5, -1);
      scene.add(dir2);

      if (typeof THREE.OrbitControls === 'function') {
        controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
      } else {
        // OrbitControls script failed to load (CDN blocked, etc).
        // Fall back to basic manual drag-to-rotate so the viewer still works.
        console.error('[3D Model Viewer] THREE.OrbitControls not found — using manual fallback controls.');
        controls = createFallbackControls(camera, renderer.domElement);
      }

      resizeRenderer();
      resizeObserver = new ResizeObserver(resizeRenderer);
      resizeObserver.observe(wrap);

      animate();
    }

    /* Minimal drag-to-rotate / scroll-to-zoom fallback, used only if the
       OrbitControls CDN script fails to load for some reason. */
    function createFallbackControls(cam, domEl) {
      const state = { target: new THREE.Vector3(), dragging: false, lastX: 0, lastY: 0, theta: 0.8, phi: 1.0, radius: 100 };

      function applyPosition() {
        const x = state.target.x + state.radius * Math.sin(state.phi) * Math.sin(state.theta);
        const y = state.target.y + state.radius * Math.cos(state.phi);
        const z = state.target.z + state.radius * Math.sin(state.phi) * Math.cos(state.theta);
        cam.position.set(x, y, z);
        cam.lookAt(state.target);
      }

      domEl.addEventListener('pointerdown', (e) => { state.dragging = true; state.lastX = e.clientX; state.lastY = e.clientY; });
      window.addEventListener('pointerup', () => { state.dragging = false; });
      window.addEventListener('pointermove', (e) => {
        if (!state.dragging) return;
        state.theta -= (e.clientX - state.lastX) * 0.007;
        state.phi = Math.min(Math.max(state.phi - (e.clientY - state.lastY) * 0.007, 0.15), Math.PI - 0.15);
        state.lastX = e.clientX; state.lastY = e.clientY;
        applyPosition();
      });
      domEl.addEventListener('wheel', (e) => {
        e.preventDefault();
        state.radius = Math.max(state.radius * (1 + e.deltaY * 0.001), 0.5);
        applyPosition();
      }, { passive: false });

      applyPosition();

      return {
        target: state.target,
        update: applyPosition,
        __setRadius(r) { state.radius = r; applyPosition(); }
      };
    }

    function resizeRenderer() {
      if (!renderer) return;
      const w = wrap.clientWidth, h = wrap.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }

    function animate() {
      requestAnimationFrame(animate);
      if (controls) controls.update();
      if (renderer && scene && camera) renderer.render(scene, camera);
    }

    function clearModel() {
      if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); mesh = null; }
      if (wireframe) { scene.remove(wireframe); wireframe.geometry.dispose(); wireframe.material.dispose(); wireframe = null; }
    }

    function buildModel(positions) {
      clearModel();

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.computeVertexNormals();

      const material = new THREE.MeshStandardMaterial({
        color: 0xb9c0cc,
        metalness: 0.35,
        roughness: 0.55,
        side: THREE.DoubleSide,
        flatShading: true
      });
      mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);

      const edgeGeo = new THREE.EdgesGeometry(geometry, 25);
      const edgeMat = new THREE.LineBasicMaterial({ color: 0xf5b300, transparent: true, opacity: 0.35 });
      wireframe = new THREE.LineSegments(edgeGeo, edgeMat);
      scene.add(wireframe);

      // Frame camera to the model's bounding sphere
      geometry.computeBoundingSphere();
      const sphere = geometry.boundingSphere;
      const center = sphere.center;
      const radius = Math.max(sphere.radius, 1);

      controls.target.copy(center);
      camera.near = radius / 100;
      camera.far = radius * 100;
      camera.updateProjectionMatrix();

      if (typeof controls.__setRadius === 'function') {
        // fallback controls: let it recompute camera.position from target+radius
        controls.__setRadius(radius * 2);
      } else {
        // real OrbitControls: set position directly, then sync
        camera.position.set(
          center.x + radius * 1.4,
          center.y + radius * 1.1,
          center.z + radius * 1.4
        );
        controls.update();
      }
    }

    /* Builds a simple illustrative stud-wall-frame mesh entirely in
       JS — no file fetch involved. Used as the default/fallback so
       something always renders, even before real DXF files are
       confirmed live on the server. */
    function buildSampleFramePositions() {
      const positions = [];
      const addBox = (x, y, z, w, h, d) => {
        const x0 = x - w / 2, x1 = x + w / 2;
        const y0 = y, y1 = y + h;
        const z0 = z - d / 2, z1 = z + d / 2;
        const v = [
          [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], // front
          [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]  // back
        ];
        const faces = [
          [0, 1, 2], [0, 2, 3], [4, 5, 6], [4, 6, 7], // front, back
          [0, 1, 5], [0, 5, 4], [3, 2, 6], [3, 6, 7], // bottom, top
          [0, 3, 7], [0, 7, 4], [1, 2, 6], [1, 6, 5]  // left, right
        ];
        faces.forEach(f => f.forEach(i => positions.push(...v[i])));
      };

      // A simple stud-wall frame: sole plate, top plate, studs, one header.
      const wallW = 240, wallH = 96, studD = 4, studW = 3.5;
      addBox(0, 0, 0, wallW, 3.5, studD);          // sole plate
      addBox(0, wallH - 3.5, 0, wallW, 3.5, studD); // top plate
      for (let x = -wallW / 2 + studW / 2; x <= wallW / 2 - studW / 2; x += 16) {
        addBox(x, 3.5, 0, studW, wallH - 7, studD);
      }
      addBox(0, wallH - 24, 0, 48, 6, studD); // header over a rough opening

      return positions;
    }

    function loadModel(key) {
      loadingText.textContent = 'Loading model…';
      loadingEl.classList.remove('hidden');
      errorEl.classList.remove('visible');

      if (typeof THREE === 'undefined') {
        loadingEl.classList.add('hidden');
        errorEl.textContent = 'The 3D library (Three.js) didn\'t load — check your internet connection or try disabling any ad/script blocker, then refresh.';
        errorEl.classList.add('visible');
        console.error('[3D Model Viewer] THREE is undefined — the three.js CDN script did not load.');
        return;
      }

      // Built-in sample — always works, no data lookup needed.
      if (key === '__sample__') {
        try {
          const positions = buildSampleFramePositions();
          if (!renderer) initScene();
          buildModel(positions);
          gaEvent('view_item', { item_name: 'sample_frame', item_category: '3d_model' });
          loadingEl.classList.add('hidden');
        } catch (err) {
          loadingEl.classList.add('hidden');
          errorEl.textContent = 'Couldn\'t render the sample frame: ' + err.message;
          errorEl.classList.add('visible');
          console.error('[3D Model Viewer]', err);
        }
        return;
      }

      // Each real model's raw DXF text lives in its own file at
      // models/<key>.js, loaded via a normal <script src="..."> tag in
      // index.html (see the "3D MODEL DATA" block right before this
      // script). Each of those files just assigns its DXF text onto
      // window.DXF_DATA[key] — a plain <script src> load, unlike fetch(),
      // works fine when the page is opened directly off disk (file://),
      // so the viewer needs no local server to run.
      try {
        const text = window.DXF_DATA && window.DXF_DATA[key];
        if (!text || text.trim().length === 0) {
          throw new Error(`No data found for "${key}". Check that models/${key}.js is included in index.html and loaded before model-viewer.js.`);
        }

        loadingText.textContent = 'Rendering geometry…';
        const positions = parseDXF(text);

        if (positions.length === 0) {
          throw new Error(`Parsed "${key}" but found no 3DFACE mesh data in it.`);
        }

        if (!renderer) initScene();
        buildModel(positions);

        gaEvent('view_item', { item_name: key, item_category: '3d_model' });
        loadingEl.classList.add('hidden');
      } catch (err) {
        loadingEl.classList.add('hidden');
        errorEl.textContent = 'Couldn\'t load this model: ' + err.message;
        errorEl.classList.add('visible');
        console.error('[3D Model Viewer]', err);
      }
    }

    select.addEventListener('change', () => {
      gaEvent('select_content', { content_type: '3d_model', item_id: select.value });
      loadModel(select.value);
    });

    // Load the first model once this section actually scrolls into view,
    // so we're not fetching megabytes of DXF data on every page load.
    const section = document.getElementById('model-viewer');
    if ('IntersectionObserver' in window && section) {
      let started = false;
      const io = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting && !started) {
            started = true;
            loadModel(select.value);
            io.disconnect();
          }
        });
      }, { threshold: 0.2 });
      io.observe(section);
    } else {
      loadModel(select.value);
    }
  })();
