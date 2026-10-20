import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { OBJLoader } from 'three/addons/OBJLoader.js';
import { GLTFLoader } from 'three/addons/GLTFLoader.js';
import { loadSiteInfo, openSiteInfo } from './siteinfo.js?v=2';

const el = (id) => document.getElementById(id);
const infoEl = el('info');
const loadEl = el('loading');
const loadLabel = el('loadLabel');
const loadBar = el('loadBar');

// Escape for the one spot that builds info-panel HTML from manifest strings
// (crs, attribution); every other dynamic string uses textContent.
const escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Manifest/dataset paths are resolved under ./data/. Reject values that
// could escape that directory (absolute, scheme'd, backslash, or '..').
const safeRelPath = (p) => {
  if (typeof p !== 'string') return null;
  const s = p.trim();
  if (!s || s.startsWith('/') || s.includes('\\') || s.includes('%')) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) return null;
  if (s.split('/').some((seg) => seg === '..')) return null;
  return s;
};
const dataPath = (p) => {
  const rel = safeRelPath(p);
  return rel == null ? null : './data/' + rel;
};
const fetchDataJson = async (p) => {
  const url = dataPath(p);
  if (!url) throw new Error(`unsafe data path: ${p}`);
  return (await fetch(url)).json();
};

// Fallback display name for a dataset id ("mtmayon" -> "Mount Mayon").
// data/site_info.json carries the authoritative name when a site has
// notes, so this only has to be good enough for undocumented datasets.
const pretty = (s) => String(s).replace(/^mt/i, 'Mount ').replace(/^lake/i, 'Lake ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b([a-z])/g, (c) => c.toUpperCase());

function showError(msg) {
  el('errMsg').textContent = msg;
  el('errbox').style.display = 'block';
  loadEl.style.display = 'none';
  console.error(msg);
}

const SETTINGS_KEY = 'demviewer-settings';
const loadSettings = () => {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; }
  catch { return {}; }
};
const saveSettings = (s) => {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* private mode */ }
};

async function main() {
  const params = new URLSearchParams(location.search);
  // Default manifest: explicit ?m= wins; else manifest.json; else the
  // first dataset registered by export_web (fresh single-dataset sites
  // often only have e.g. mtApo.json).
  let manifestFile = safeRelPath(params.get('m') || 'manifest.json');
  if (!manifestFile) {
    showError('Invalid dataset path in ?m=.');
    return;
  }
  let res = await fetch('./data/' + manifestFile);
  if (!res.ok && !params.get('m')) {
    try {
      const reg = await (await fetch('./data/datasets.json')).json();
      if (Array.isArray(reg) && reg.length) {
        const first = safeRelPath(reg[0].file);
        if (first) {
          manifestFile = first;
          res = await fetch('./data/' + manifestFile);
        }
      }
    } catch { /* fall through to the error below */ }
  }
  if (!res.ok) {
    showError(`manifest ${manifestFile} not found (HTTP ${res.status}). ` +
      `Export a dataset into this site first.`);
    return;
  }
  const manifest = await res.json();

  if (manifest.earth_model !== 'flat') {
    showError(`earth_model=${manifest.earth_model}: viewer supports flat only.`);
    return;
  }
  if (manifest.z_exaggeration !== 1.0) {
    showError(`z_exaggeration=${manifest.z_exaggeration}: export at 1.0 for the web viewer.`);
    return;
  }

  // Render-verified per dataset: manifest.texture_flip_y selects the
  // upload flip (false for all datasets so far; true mirrors N/S).
  const flipY = manifest.texture_flip_y === true;

  // Appearance theme from the manifest (export --theme); falls back to
  // dark, matching the landing page. Scene background follows the theme too.
  document.body.dataset.theme = manifest.theme || 'dark';

  // "About this site" notes — hand-written prose per dataset, keyed by
  // the dataset id (manifest.name) in data/site_info.json. Loaded once,
  // up front: the names it carries are authoritative (site_info.json
  // knows "Mount Bud Dajo" where the id-derived fallback cannot), and
  // the About button must be usable while the large scene still loads.
  const siteInfo = await loadSiteInfo();
  const siteEntry = siteInfo[manifest.name] || null;
  const siteName = (siteEntry && siteEntry.name) || pretty(manifest.name);
  const nameOf = (id) => (siteInfo[id] && siteInfo[id].name) || pretty(id);
  const aboutSection = el('aboutSection');
  const aboutBtn = el('aboutBtn');
  if (aboutSection && aboutBtn && siteEntry) {
    aboutSection.style.display = '';
    aboutBtn.textContent = 'About ' + siteName;
    aboutBtn.onclick = () => openSiteInfo(manifest.name, { syncUrl: true });
    // ?info=1 deep link: open the notes straight away.
    if (params.get('info')) openSiteInfo(manifest.name, { syncUrl: true });
  }
  const dsTitle = el('dsTitle');
  if (dsTitle) dsTitle.textContent = siteName;

  const container = document.getElementById('app');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  // Part 2: shadow-mapped sun. PCFSoft + per-mesh cast/receive flags below.
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const themeBg = getComputedStyle(document.body).getPropertyValue('--scene-bg').trim();
  scene.background = new THREE.Color(themeBg || '#0b0e13');

  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 1, 1e7);
  camera.up.set(0, 0, 1); // Z-up: mesh Z is absolute elevation

  // Untextured + textured materials. Each tile gets its own textured
  // material (map differs per tile); the mode switch swaps mesh.material.
  // Phong (not Lambert) so a specular highlight can be dialled in; specular
  // starts black, which renders exactly like the old Lambert material.
  const untexturedMat = new THREE.MeshPhongMaterial({
    color: 0x9aa37a, specular: 0x000000, shininess: 30,
  });
  const texLoader = new THREE.TextureLoader();
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  // Hillshade = white surface + single directional sun, no ambient.
  // Normal-view lights (sun + hemisphere) and hillshade sun are mutually
  // exclusive so hillshade stays pure N·L unless specular is raised.
  const hillshadeMat = new THREE.MeshPhongMaterial({
    color: 0xffffff, specular: 0x000000, shininess: 30,
  });

  // Height = hypsometric tint from per-vertex colors (see applyHeightColors).
  // Untextured/hillshade specular does not apply here, so it stays diffuse.
  const heightMat = new THREE.MeshPhongMaterial({
    vertexColors: true, specular: 0x000000, shininess: 30,
  });

  // Classic hypsometric ramp: deep green (low) -> green -> yellow -> tan /
  // orange -> brown -> white (peaks). Stops are t in [0,1] over the dataset
  // elevation range; colours are lerped in three's working (linear) space.
  const HYPSO_STOPS = [
    [0.00, 0x006837],
    [0.20, 0x4c9f4c],
    [0.40, 0xa7c957],
    [0.55, 0xf2e05a],
    [0.70, 0xd98e3b],
    [0.85, 0x9c5a2a],
    [1.00, 0xffffff],
  ];
  const hypsoStops = HYPSO_STOPS.map(([t, hex]) => [t, new THREE.Color(hex)]);
  const hypsoSample = (t, out) => {
    const u = t < 0 ? 0 : (t > 1 ? 1 : t);
    let i = hypsoStops.length - 2;
    while (i > 0 && u < hypsoStops[i][0]) i--;
    const [t0, c0] = hypsoStops[i];
    const [t1, c1] = hypsoStops[i + 1];
    const f = t1 > t0 ? (u - t0) / (t1 - t0) : 0;
    return out.copy(c0).lerp(c1, f);
  };

  // Bake a hypsometric `color` attribute onto a terrain geometry once, so the
  // Height mode toggles instantly (colors travel with the geometry; only the
  // material is swapped). Uses the dataset-wide Z range when the elevation
  // grid loaded, else the tile's own span as a fallback.
  const applyHeightColors = (geo) => {
    if (geo.getAttribute('color')) return;
    const pos = geo.getAttribute('position');
    if (!pos) return;
    let zmin = zRange[0];
    let zmax = zRange[1];
    if (!elevGrid) {
      zmin = Infinity; zmax = -Infinity;
      for (let i = 0; i < pos.count; i++) {
        const z = pos.getZ(i);
        if (z < zmin) zmin = z;
        if (z > zmax) zmax = z;
      }
      if (!Number.isFinite(zmin) || !Number.isFinite(zmax)) { zmin = 0; zmax = 1; }
    }
    const span = Math.max(zmax - zmin, 1e-6);
    const c = new THREE.Color();
    const arr = new Uint8Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      hypsoSample((pos.getZ(i) - zmin) / span, c);
      arr[i * 3] = Math.round(c.r * 255);
      arr[i * 3 + 1] = Math.round(c.g * 255);
      arr[i * 3 + 2] = Math.round(c.b * 255);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3, true));
  };

  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(-0.5, -1.0, 1.2);
  scene.add(sun);
  const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x3a352c, 0.7);
  scene.add(hemi);

  // Hillshade sun: positioned from geographic azimuth (deg clockwise from
  // north) / altitude (deg above horizon). Scene axes: X=east, Y=north, Z=up.
  // Shadow camera is fitted to the dataset in fitShadows() once extent is
  // known; normalBias is in world units (tune if acne stripes appear).
  const hillSun = new THREE.DirectionalLight(0xffffff, 1.6);
  hillSun.visible = false;
  hillSun.castShadow = true;
  hillSun.shadow.bias = -0.0002;
  hillSun.shadow.normalBias = 10;
  scene.add(hillSun);
  scene.add(hillSun.target);
  const placeHillSun = (azDeg, altDeg) => {
    const az = THREE.MathUtils.degToRad(azDeg);
    const alt = THREE.MathUtils.degToRad(altDeg);
    const r = extentHillSunDist();
    hillSun.position.set(
      Math.cos(alt) * Math.sin(az) * r,
      Math.cos(alt) * Math.cos(az) * r,
      Math.sin(alt) * r,
    );
  };
  // Sun distance scales with scene size; defined after extent is known.
  let extentHillSunDist = () => 10000;

  // Exaggeration scales a parent group about Z=0 (sea level stays fixed
  // because Z is absolute elevation and the group is XY-centred only).
  // Independent per-layer factors were tried and reverted: with different
  // factors building bases detach from the slopes, since no single
  // transform can follow varying base elevations.
  const scaleGroup = new THREE.Group();
  scene.add(scaleGroup);
  const terrainGroup = new THREE.Group();
  scaleGroup.add(terrainGroup);
  // Buildings live under the same scaled parent so bases stay registered
  // with the terrain at any exaggeration.
  const buildingsGroup = new THREE.Group();
  scaleGroup.add(buildingsGroup);
  const buildingsMat = new THREE.MeshLambertMaterial({
    color: 0xd8d3c8, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  });

  const objLoader = new OBJLoader();
  const gltfLoader = new GLTFLoader();
  // .glb (binary glTF) or .obj by file extension. A GLB tile may carry
  // its texture embedded; its map is reused with the same flipY as the
  // PNG path (same bytes + same UVs + same flip).
  const loadModel = (path) => path.endsWith('.glb')
    ? gltfLoader.loadAsync(path).then((g) => g.scene)
    : objLoader.loadAsync(path);
  // Map embedded in a GLB tile (used as the textured variant). Returns
  // null when no mesh carries a map (then the tile falls back to flat).
  const embeddedMap = (obj) => {
    let found = null;
    obj.traverse((child) => {
      if (found || !child.isMesh) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      const withMap = mats.find((m) => m && m.map);
      if (withMap) {
        withMap.map.flipY = flipY;
        withMap.map.needsUpdate = true;
        found = new THREE.MeshLambertMaterial({ map: withMap.map, alphaTest: 0.5 });
      }
    });
    return found;
  };

  // ---- Lazy-load stepping stone (§8.1): frame from manifest bounds, ----
  // ---- fetch tiles on frustum entry instead of all upfront. No export ----
  // ---- changes; old single-mesh datasets (no bounds) load as before. ----
  let mode = 'textured'; // declared early so late tiles get the live mode
  const pickTileMaterial = (texturedMat) => mode === 'hillshade'
    ? hillshadeMat
    : mode === 'height' ? heightMat
      : (mode === 'textured' && texturedMat) ? texturedMat : untexturedMat;

  const ox0 = (manifest.origin && manifest.origin[0]) || 0;
  const oy0 = (manifest.origin && manifest.origin[1]) || 0;
  const unionBox = new THREE.Box3();
  let hasManifestBounds = false;
  for (const t of manifest.tiles) {
    if (t.bounds && t.bounds.length === 4) {
      const [minx, miny, maxx, maxy] = t.bounds;
      unionBox.expandByPoint(new THREE.Vector3(minx - ox0, miny - oy0, 0));
      unionBox.expandByPoint(new THREE.Vector3(maxx - ox0, maxy - oy0, 0));
      hasManifestBounds = true;
    }
  }
  // Progress across every fetched file (geometry + textures + buildings).
  const expectedFiles = manifest.tiles.reduce((n, t) => n + 1 + (t.texture ? 1 : 0), 0)
    + (manifest.buildings ? 1 : 0) + (manifest.elevation_grid ? 1 : 0);
  let loadedFiles = 0;
  let firstPaintDone = false;
  let tilesLoaded = 0;
  let infoStatus = null;
  const tick = (label) => {
    loadedFiles++;
    if (!firstPaintDone) {
      loadLabel.textContent = `${label} (${loadedFiles}/${expectedFiles})`;
      loadBar.style.width = `${Math.round(100 * loadedFiles / Math.max(expectedFiles, 1))}%`;
    } else if (infoStatus) {
      infoStatus.textContent = `tiles ${tilesLoaded}/${manifest.tiles.length}`;
    }
  };

  // Elevation grid first (small file): gives Z range for framing + tile
  // boxes without waiting for any geometry. Reused later by the readout.
  let elevGrid = null;
  let zRange = [-100, 2000];
  if (manifest.elevation_grid) {
    try {
      const eg = await fetchDataJson(manifest.elevation_grid);
      const n = eg.n;
      const raw = Uint8Array.from(atob(eg.data), (c) => c.charCodeAt(0));
      elevGrid = { n, bounds: eg.bounds, z: new Float32Array(raw.buffer) };
      let zmin = Infinity, zmax = -Infinity;
      const zarr = elevGrid.z;
      for (let i = 0; i < zarr.length; i++) {
        const v = zarr[i];
        if (Number.isFinite(v)) { if (v < zmin) zmin = v; if (v > zmax) zmax = v; }
      }
      if (Number.isFinite(zmin) && Number.isFinite(zmax)) zRange = [zmin, zmax];
      tick('elevation grid');
    } catch (e) { console.warn('elevation grid skipped:', e); }
  }
  unionBox.min.z = zRange[0];
  unionBox.max.z = zRange[1];

  // Centre XY only — never Z (Z stays absolute so scale.z pivots at sea
  // level). Offset lives on the shared parent so EVERY layer (terrain +
  // buildings) recentres identically; per-layer offsets desync layers.
  // Fallback when a manifest lacks bounds (very old): centre at origin,
  // framing refines once geometry arrives.
  const cx = hasManifestBounds ? (unionBox.min.x + unionBox.max.x) / 2 : 0;
  const cy = hasManifestBounds ? (unionBox.min.y + unionBox.max.y) / 2 : 0;
  scaleGroup.position.set(-cx, -cy, 0);

  const size = new THREE.Vector3();
  unionBox.getSize(size);
  if (!hasManifestBounds) { size.set(10000, 10000, zRange[1] - zRange[0]); }
  const extent = Math.max(size.x, size.y);

  // Frame camera; near/far derived from extent
  const dist = extent * 1.1;
  camera.position.set(cx + dist * 0.7, cy - dist * 0.9, zRange[1] + dist * 0.55);
  camera.near = Math.max(1, extent / 10000);
  camera.far = extent * 20 + Math.abs(zRange[1]) + Math.abs(zRange[0]) + dist * 4;
  camera.updateProjectionMatrix();

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, (zRange[0] + zRange[1]) / 2);
  controls.update();
  hillSun.target.position.set(0, 0, (zRange[0] + zRange[1]) / 2);
  // Home snapshot for the reset button (camera only).
  const homePos = camera.position.clone();
  const homeTarget = controls.target.clone();
  const homeFov = camera.fov;

  infoEl.innerHTML =
    `${manifest.tiles.length} tiles · extent ${Math.round(size.x)} × ${Math.round(size.y)} m<br>` +
    `elevation ${zRange[0].toFixed(1)} … ${zRange[1].toFixed(1)} m<br>` +
    `CRS ${escapeHtml(manifest.crs)} · flat · exaggeration 1.0 <span style="color:#888">(v38${manifest.streaming ? '-stream' : '-lazy'})</span><br>` +
    `${escapeHtml(manifest.attribution)}`;

  // Streaming path (§8.3): tileset pyramid via stream.js. Otherwise the
  // lazy loader below runs untouched (old datasets have no `streaming`).
  let streamHandle = null;
  if (manifest.streaming) {
    const { startStreaming } = await import('./stream.js?v=41');
    const buildTileContent = (obj, tex) => {
      if (tex) {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.flipY = flipY;
        tex.anisotropy = maxAniso;
      }
      const texturedMat = tex
        ? new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5 })
        : embeddedMap(obj);
      const g = new THREE.Group();
      obj.traverse((child) => {
        if (child.isMesh) {
          const geo = child.geometry;
          if (!geo.getAttribute('normal')) geo.computeVertexNormals();
          applyHeightColors(geo);
          const mesh = new THREE.Mesh(geo, pickTileMaterial(texturedMat));
          mesh.userData.texturedMat = texturedMat;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          g.add(mesh);
        }
      });
      return g;
    };
    const buildBuildings = (bObj) => {
      bObj.traverse((child) => {
        if (child.isMesh) {
          const g = child.geometry;
          if (!g.getAttribute('normal')) g.computeVertexNormals();
          const mesh = new THREE.Mesh(g, mode === 'hillshade' ? hillshadeMat : buildingsMat);
          mesh.userData.isBuilding = true;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          buildingsGroup.add(mesh);
        }
      });
    };
    // quality/effectiveQuality are declared later; the try/catch keeps the
    // initial pump (which runs synchronously here) on the safe default.
    const getMaxDetail = () => {
      try {
        return quality === 'high' ? 2 : (effectiveQuality() === 'low' ? 1 : 2);
      } catch { return 2; }
    };
    streamHandle = await startStreaming({
      manifest, basePath: './data/', camera, controls,
      scaleGroup, terrainGroup, buildingsGroup,
      buildTileContent, buildBuildings, getMaxDetail,
      loadLabel, loadBar, loadEl, infoEl, zRange,
    });
  } else {
  const infoStatusEl = document.createElement('div');
  infoStatusEl.textContent = `tiles 0/${manifest.tiles.length} (lazy loading…)`;
  infoEl.appendChild(infoStatusEl);
  infoStatus = infoStatusEl;

  // Per-tile state. Boxes are geometry-local (origin-relative); world =
  // local + scaleGroup offset, Z scaled by exaggeration. Using the global
  // zRange is conservative (never culls a tile that is actually visible).
  const tileStates = manifest.tiles.map((t, i) => {
    let box = null;
    if (t.bounds && t.bounds.length === 4) {
      const [minx, miny, maxx, maxy] = t.bounds;
      box = new THREE.Box3(
        new THREE.Vector3(minx - ox0, miny - oy0, zRange[0]),
        new THREE.Vector3(maxx - ox0, maxy - oy0, zRange[1]));
    }
    return { i, t, status: 'idle', box };
  });
  const worldBoxOf = (box) => {
    const k = scaleGroup.scale.z || 1;
    return new THREE.Box3(
      new THREE.Vector3(box.min.x + scaleGroup.position.x,
        box.min.y + scaleGroup.position.y, Math.min(box.min.z, box.max.z) * k),
      new THREE.Vector3(box.max.x + scaleGroup.position.x,
        box.max.y + scaleGroup.position.y, Math.max(box.min.z, box.max.z) * k));
  };
  const frustum = new THREE.Frustum();
  const projMat = new THREE.Matrix4();
  let activeLoads = 0;
  const MAX_CONCURRENT = 4;

  const loadTile = async (st) => {
    st.status = 'loading';
    activeLoads++;
    try {
      const filePath = dataPath(st.t.file);
      const texPath = st.t.texture ? dataPath(st.t.texture) : null;
      if (!filePath || (st.t.texture && !texPath)) {
        throw new Error(`unsafe tile path: ${st.t.file}`);
      }
      const [obj, tex] = await Promise.all([
        loadModel(filePath).then((o) => { tick(`terrain ${st.t.file}`); return o; }),
        texPath
          ? texLoader.loadAsync(texPath).then((x) => { tick(`texture`); return x; })
          : Promise.resolve(null),
      ]);
      if (tex) {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.flipY = flipY;
        tex.anisotropy = maxAniso;
      }
      const texturedMat = tex
        ? new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5 })
        : embeddedMap(obj);
      const nowMat = pickTileMaterial(texturedMat);
      obj.traverse((child) => {
        if (child.isMesh) {
          const g = child.geometry;
          if (!g.getAttribute('normal')) g.computeVertexNormals();
          applyHeightColors(g);
          const mesh = new THREE.Mesh(g, nowMat);
          mesh.userData.texturedMat = texturedMat;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          terrainGroup.add(mesh);
          g.computeBoundingBox();
          // Refine the approx union box with real geometry (info only;
          // camera stays as framed from the manifest).
          unionBox.union(g.boundingBox);
        }
      });
      st.status = 'loaded';
      tilesLoaded++;
    } catch (e) {
      console.warn(`tile ${st.t.file} failed:`, e);
      st.status = 'error';
    } finally {
      activeLoads--;
      if (!firstPaintDone) {
        firstPaintDone = true;
        loadEl.style.display = 'none';
      }
      infoStatus.textContent = `tiles ${tilesLoaded}/${manifest.tiles.length}`;
      pumpQueue();
    }
  };

  const pumpQueue = () => {
    camera.updateMatrixWorld();
    projMat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projMat);
    const want = [];
    for (const st of tileStates) {
      if (st.status !== 'idle') continue;
      if (!st.box) { want.push({ st, d: 0 }); continue; } // no bounds: load now
      if (frustum.intersectsBox(worldBoxOf(st.box))) {
        const c = st.box.getCenter(new THREE.Vector3());
        c.x += scaleGroup.position.x; c.y += scaleGroup.position.y;
        want.push({ st, d: camera.position.distanceTo(c) });
      }
    }
    want.sort((a, b) => a.d - b.d);
    for (const { st } of want) {
      if (activeLoads >= MAX_CONCURRENT) break;
      loadTile(st);
    }
    // Nothing in frustum and nothing loading/loaded yet (e.g. camera
    // starts looking away): load the nearest tile so first paint happens.
    if (!firstPaintDone && activeLoads === 0 && tilesLoaded === 0) {
      const st = tileStates.find((s) => s.status === 'idle');
      if (st) loadTile(st);
    }
  };
  let pumpTimer = null;
  const schedulePump = () => {
    if (pumpTimer) return;
    pumpTimer = setTimeout(() => { pumpTimer = null; pumpQueue(); }, 150);
  };
  controls.addEventListener('change', schedulePump);
  pumpQueue();

  // Optional buildings layer (second group, same frame). Loads after first
  // paint so it never blocks terrain; single whole-scene file for now
  // (spatial tiling comes with the streaming exporter).
  let buildingCount = 0;
  const loadBuildings = async () => {
    if (!manifest.buildings) return;
    try {
      const bPath = dataPath(manifest.buildings);
      if (!bPath) throw new Error('unsafe buildings path');
      const bObj = await loadModel(bPath);
      tick('buildings');
      bObj.traverse((child) => {
        if (child.isMesh) {
          const g = child.geometry;
          if (!g.getAttribute('normal')) g.computeVertexNormals();
          const mesh = new THREE.Mesh(g, mode === 'hillshade' ? hillshadeMat : buildingsMat);
          mesh.userData.isBuilding = true;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          buildingsGroup.add(mesh);
          buildingCount++;
        }
      });
    } catch (e) { console.warn('buildings skipped:', e); }
  };
  // Start buildings once the first terrain tile paints (or after 8 s max).
  const lazyT0 = Date.now();
  const buildingsKick = setInterval(() => {
    if (firstPaintDone || (Date.now() - lazyT0) > 8000) {
      clearInterval(buildingsKick);
      loadBuildings();
    }
  }, 500);
  } // end lazy path (streaming path above runs via stream.js)

  const settings = loadSettings();
  const persist = () => saveSettings({
    mode, exagg: exagg.value, az: sunAz.value, alt: sunAlt.value,
    bld: chkBld ? chkBld.checked : true,
    bldAll: el('chkBldAll') ? el('chkBldAll').checked : false,
    shadow: chkShadow.checked,
    focal: focal.value,
    colU: colUntex.value, colH: colHill.value,
    spec: specInt.value, shine: specShine.value,
    quality,
  });

  // Dataset switcher (URL ?m= stays the source of truth). Populated from
  // data/datasets.json, which export_web maintains on every export.
  const currentM = manifestFile;
  let datasetList = [{ label: manifest.name, file: currentM }];
  try {
    const reg = await (await fetch('./data/datasets.json')).json();
    if (Array.isArray(reg) && reg.length) {
      const clean = reg.filter((d) => d && typeof d === 'object'
        && safeRelPath(d.file) !== null);
      if (clean.length) datasetList = clean;
    }
  } catch { /* single dataset */ }
  const dsSel = el('dsSel');
  datasetList.forEach((d) => {
    const file = safeRelPath(d.file);
    if (!file) return;
    const o = document.createElement('option');
    o.value = file;
    o.textContent = nameOf(d.label);
    if (file === currentM) o.selected = true;
    dsSel.appendChild(o);
  });
  dsSel.onchange = () => {
    location.search = '?m=' + encodeURIComponent(dsSel.value);
  };

  // Collapsible panel; start collapsed on small screens.
  const panel = el('panel');
  const collapseBtn = el('collapseBtn');
  const setCollapsed = (c) => {
    panel.classList.toggle('collapsed', c);
    collapseBtn.textContent = c ? '+' : '–';
  };
  el('panelHead').onclick = (e) => {
    if (e.target === collapseBtn) return;
    setCollapsed(!panel.classList.contains('collapsed'));
  };
  collapseBtn.onclick = () => setCollapsed(!panel.classList.contains('collapsed'));
  if (window.innerWidth <= 700) setCollapsed(true);

  extentHillSunDist = () => extent * 3;
  // Fit the shadow camera to the dataset once; far plane covers 5x relief.
  const fitShadows = () => {
    const r = extent * 3;
    const c = hillSun.shadow.camera;
    const d = extent * 0.75;
    c.left = -d; c.right = d; c.top = d; c.bottom = -d;
    c.near = Math.max(1, r - extent * 1.5);
    c.far = r + extent * 1.5 + Math.abs(zRange[1]) * 5;
    const smallScreen = window.innerWidth <= 700;
    hillSun.shadow.mapSize.set(smallScreen ? 1024 : 2048, smallScreen ? 1024 : 2048);
    if (hillSun.shadow.map) { hillSun.shadow.map.dispose(); hillSun.shadow.map = null; }
    c.updateProjectionMatrix();
  };
  fitShadows();
  const sunAz = el('sunAz');
  const sunAlt = el('sunAlt');
  const sunAzVal = el('sunAzVal');
  const sunAltVal = el('sunAltVal');
  const updateHillSun = () => {
    sunAzVal.textContent = `${sunAz.value}°`;
    sunAltVal.textContent = `${sunAlt.value}°`;
    placeHillSun(Number(sunAz.value), Number(sunAlt.value));
    persist();
  };
  sunAz.oninput = updateHillSun;
  sunAlt.oninput = updateHillSun;

  // Render quality: Auto picks by device, High/Low override. Low caps the
  // pixel ratio at 1 and forces shadows off (the two biggest fan drivers
  // on weak laptops: full-res shading + shadow maps).
  let quality = 'auto';
  const effectiveQuality = () => quality === 'high' ? 'high'
    : quality === 'low' ? 'low'
    : ((window.innerWidth <= 700 || (navigator.hardwareConcurrency || 8) <= 4) ? 'low' : 'high');
  const applyQuality = () => {
    const q = effectiveQuality();
    renderer.setPixelRatio(q === 'low' ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    if (q === 'low' && hillSun.castShadow) {
      hillSun.castShadow = false;
      if (chkShadow) chkShadow.checked = false;
    }
    document.querySelectorAll('#qualitySeg button').forEach((b) => {
      b.classList.toggle('active', b.dataset.quality === quality);
    });
    persist();
    if (streamHandle) streamHandle.poke(); // mobile L1 cap may have changed
  };
  document.querySelectorAll('#qualitySeg button').forEach((b) => {
    b.onclick = () => { quality = b.dataset.quality; applyQuality(); };
  });

  // mode declared earlier (lazy loader needs it at tile-load time).
  const setMode = (next) => {
    mode = next;
    const hill = mode === 'hillshade';
    sun.visible = !hill;
    hemi.visible = !hill;
    hillSun.visible = hill;
    el('sunSection').style.display = hill ? '' : 'none';
    terrainGroup.traverse((child) => {
      if (child.isMesh) {
        child.material = hill
          ? hillshadeMat
          : (mode === 'textured' && child.userData.texturedMat)
            ? child.userData.texturedMat
            : mode === 'height' ? heightMat
              : untexturedMat;
      }
    });
    buildingsGroup.traverse((child) => {
      if (child.isMesh) child.material = hill ? hillshadeMat : buildingsMat;
    });
    document.querySelectorAll('#modeSeg button').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    persist();
  };
  document.querySelectorAll('#modeSeg button').forEach((b) => {
    b.onclick = () => setMode(b.dataset.mode);
  });

  const exagg = el('exagg');
  const exaggVal = el('exaggVal');
  const zMid = (zRange[0] + zRange[1]) / 2;
  exagg.oninput = () => {
    const k = Number(exagg.value);
    exaggVal.textContent = `${k.toFixed(1)}×`;
    scaleGroup.scale.z = k;
    controls.target.z = zMid * k;
    camera.far = extent * 20 + Math.abs(zRange[1] * k) + Math.abs(zRange[0] * k) + dist * 4;
    camera.updateProjectionMatrix();
    persist();
    if (streamHandle) streamHandle.poke(); // culling boxes scale with Z
  };

  // v2.1 camera controls: focal slider (35mm-equiv), fly-to-point,
  // reset-camera and restore-defaults icon buttons.
  const focal = el('focal');
  const focalVal = el('focalVal');
  const mmToFov = (mm) => 2 * Math.atan(12 / mm) * 180 / Math.PI;
  const applyFocal = () => {
    focalVal.textContent = `${focal.value} mm`;
    camera.fov = mmToFov(Number(focal.value));
    camera.updateProjectionMatrix();
    persist();
  };
  focal.oninput = applyFocal;
  el('resetBtn').onclick = () => {
    camera.position.copy(homePos);
    controls.target.copy(homeTarget);
    controls.enablePan = true;
    controls.enableZoom = true;
    marker.visible = markerPlaced;
    standMode = false;
    focusBtn.classList.remove('active');
    focal.value = Math.round(12 / Math.tan(homeFov * Math.PI / 360));
    applyFocal();
    controls.update();
  };
  el('homeBtn').onclick = () => {
    setMode('textured');
    exagg.value = 1;
    exagg.dispatchEvent(new Event('input'));
    sunAz.value = 315;
    sunAlt.value = 45;
    updateHillSun();
    specInt.value = '0';
    specShine.value = '30';
    applySpecular();
    if (chkShadow) {
      chkShadow.checked = window.innerWidth > 700;
      chkShadow.dispatchEvent(new Event('change'));
    }
    if (chkBld) {
      chkBld.checked = true;
      buildingsGroup.visible = true;
      persist();
    }
    try { localStorage.removeItem(SETTINGS_KEY); } catch { /* private mode */ }
    persist();
  };
  const focusBtn = el('focusBtn');
  focusBtn.onclick = () => {
    if (standMode) {
      // Second click: free the camera where it stands (like reset, but
      // without moving). Click selection resumes.
      controls.enablePan = true;
      controls.enableZoom = true;
      marker.visible = markerPlaced;
      standMode = false;
      focusBtn.classList.remove('active');
      controls.update();
      return;
    }
    if (!marker.visible) return;
    // Stand on the point: eye just above the marker, gaze carried over
    // from the current view direction (projected to horizontal).
    const eyeH = Math.max(2, extent / 1000);
    const fwd = controls.target.clone().sub(camera.position);
    fwd.z = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(1, 0, 0);
    fwd.normalize();
    camera.position.set(
      marker.position.x, marker.position.y, marker.position.z + eyeH);
    // Pivot on the point itself: target = marker, eye pulled slightly back
    // along the incoming gaze so orbiting looks around from the spot.
    controls.target.copy(marker.position);
    camera.position.addScaledVector(fwd, -eyeH * 2);
    // Stand mode: rotate + pan (height control) free; zoom locked until
    // reset so you can't dolly out of the spot.
    // Marker hides so it doesn't block the view; reset restores it.
    controls.enablePan = true;
    controls.enableZoom = false;
    marker.visible = false;
    standMode = true;
    focusBtn.classList.add('active');
    controls.update();
  };

  // User-set base colors (persisted). Hillshade stays a single-hue
  // material so shading remains pure N·L, just tinted (specular optional).
  const colUntex = el('colUntex');
  const colHill = el('colHill');
  colUntex.oninput = () => { untexturedMat.color.set(colUntex.value); persist(); };
  colHill.oninput = () => { hillshadeMat.color.set(colHill.value); persist(); };
  if (settings.colU && /^#[0-9a-fA-F]{6}$/.test(settings.colU)) {
    colUntex.value = settings.colU;
    untexturedMat.color.set(settings.colU);
  }
  if (settings.colH && /^#[0-9a-fA-F]{6}$/.test(settings.colH)) {
    colHill.value = settings.colH;
    hillshadeMat.color.set(settings.colH);
  }

  // Specular highlight on untextured + hillshade terrain (off by default, so
  // shading stays pure N·L until the user asks for sheen). Textured tiles and
  // the Height tint keep their own materials and are unaffected.
  const specInt = el('specInt');
  const specShine = el('specShine');
  const specIntVal = el('specIntVal');
  const specShineVal = el('specShineVal');
  const applySpecular = () => {
    const s = Number(specInt.value);
    const sh = Number(specShine.value);
    specIntVal.textContent = s.toFixed(2);
    specShineVal.textContent = String(sh);
    for (const m of [untexturedMat, hillshadeMat]) {
      m.specular.setScalar(s);
      m.shininess = sh;
    }
  };
  specInt.oninput = () => { applySpecular(); persist(); };
  specShine.oninput = () => { applySpecular(); persist(); };
  if (settings.spec !== undefined) specInt.value = String(settings.spec);
  if (settings.shine !== undefined) specShine.value = String(settings.shine);
  applySpecular();

  const chkBld = manifest.buildings ? el('chkBld') : null;
  if (manifest.buildings) {
    el('layerSection').style.display = '';
    chkBld.onchange = () => {
      if (streamHandle) streamHandle.poke(); // stream owns visibility
      else buildingsGroup.visible = chkBld.checked;
      persist();
    };
    // Streaming only: opt-in to buildings below L2 (bases may float a few
    // metres on decimated L0/L1 terrain). Hidden on the classic path, where
    // the single buildings file always loads with the terrain.
    const chkBldAll = el('chkBldAll');
    if (manifest.streaming) {
      el('bldAllRow').style.display = '';
      chkBldAll.onchange = () => {
        streamHandle.poke();
        persist();
      };
    }
  }

  // Click-to-read elevation (+ lat/lon). Heights come from the source-DEM
  // grid, NOT the decimated mesh (plan §7: never measure the mesh).
  // UTM inverse (Snyder series, mm-accurate) avoids a proj library.
  const utmZone = (() => {
    const m = /EPSG:32([67])(\d\d)/.exec(manifest.crs || '');
    return m ? { south: m[1] === '7', zone: Number(m[2]) } : null;
  })();
  const utmToLonLat = (x, y) => {
    if (!utmZone) return null;
    const a = 6378137.0, f = 1 / 298.257223563;
    const k0 = 0.9996, e2 = 2 * f - f * f, ep2 = e2 / (1 - e2);
    const lon0 = ((utmZone.zone - 1) * 6 - 180 + 3) * Math.PI / 180;
    const X = x - 500000.0;
    let Y = y;
    if (utmZone.south) Y -= 10000000.0;
    const M = Y / k0;
    const mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256));
    const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
    const J1 = 3 * e1 / 2 - 27 * e1 * e1 * e1 / 32;
    const J2 = 21 * e1 * e1 / 16 - 55 * e1 * e1 * e1 * e1 / 16;
    const J3 = 151 * e1 * e1 * e1 / 96;
    const fp = mu + J1 * Math.sin(2 * mu) + J2 * Math.sin(4 * mu) + J3 * Math.sin(6 * mu);
    const C1 = ep2 * Math.cos(fp) * Math.cos(fp);
    const T1 = Math.tan(fp) * Math.tan(fp);
    const N1 = a / Math.sqrt(1 - e2 * Math.sin(fp) * Math.sin(fp));
    const R1 = a * (1 - e2) / Math.pow(1 - e2 * Math.sin(fp) * Math.sin(fp), 1.5);
    const D = X / (N1 * k0);
    const lat = fp - N1 * Math.tan(fp) / R1 * (D * D / 2
      - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1) * D * D * D * D / 24
      + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D * D * D * D * D * D / 720);
    const lon = lon0 + (D - (1 + 2 * T1 + C1) * D * D * D / 6
      + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D * D * D * D * D / 120) / Math.cos(fp);
    return [lon * 180 / Math.PI, lat * 180 / Math.PI];
  };
  // Elev grid already fetched pre-framing for the lazy loader; reuse it.
  if (!elevGrid && manifest.elevation_grid) {
    try {
      const eg = await fetchDataJson(manifest.elevation_grid);
      const n = eg.n;
      const raw = Uint8Array.from(atob(eg.data), (c) => c.charCodeAt(0));
      elevGrid = { n, bounds: eg.bounds, z: new Float32Array(raw.buffer) };
      tick('elevation grid');
    } catch (e) { console.warn('elevation grid skipped:', e); }
  }
  const sampleElev = (wx, wy) => { // world coords (absolute, pre-centre)
    if (!elevGrid) return null;
    const [x0, y0, x1, y1] = elevGrid.bounds;
    const n = elevGrid.n;
    const gx = (wx - x0) / (x1 - x0) * (n - 1);
    const gy = (wy - y0) / (y1 - y0) * (n - 1);
    if (gx < 0 || gy < 0 || gx > n - 1 || gy > n - 1) return null;
    const x = Math.min(Math.floor(gx), n - 2), y = Math.min(Math.floor(gy), n - 2);
    const fx = gx - x, fy = gy - y;
    const at = (ix, iy) => elevGrid.z[iy * n + ix];
    return at(x, y) * (1 - fx) * (1 - fy) + at(x + 1, y) * fx * (1 - fy)
      + at(x, y + 1) * (1 - fx) * fy + at(x + 1, y + 1) * fx * fy;
  };
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(Math.max(20, extent / 500), 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xff3333, depthTest: false, transparent: true, opacity: 0.9 }));
  marker.visible = false;
  marker.renderOrder = 999;
  let markerPlaced = false;
  scene.add(marker);
  const elevLine = document.createElement('div');
  infoEl.appendChild(elevLine);
  const raycaster = new THREE.Raycaster();
  let downAt = null;
  // Stand (focus) mode locks selection as well as movement: clicks only
  // place the marker in overview mode.
  let standMode = false;
  renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downAt || standMode) { downAt = null; return; }
    const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
    downAt = null;
    if (moved > 5) return; // was a drag, not a click
    try {
      const rect = renderer.domElement.getBoundingClientRect();
      const ptr = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ptr, camera);
      const hits = raycaster.intersectObjects([terrainGroup, buildingsGroup], true);
      if (!hits.length) {
        marker.visible = false;
        focusBtn.disabled = true;
        elevLine.textContent = 'clicked outside terrain — no reading';
        return;
      }
      const p = hits[0].point;
      // Back to absolute frame: undo centre offset and exaggeration, then
      // re-apply the manifest origin (mesh coords are origin-relative).
      const ox = (manifest.origin && manifest.origin[0]) || 0;
      const oy = (manifest.origin && manifest.origin[1]) || 0;
      const wx = p.x - scaleGroup.position.x + ox;
      const wy = p.y - scaleGroup.position.y + oy;
      const h = sampleElev(wx, wy);
      const ll = utmToLonLat(wx, wy);
      marker.position.copy(p);
      marker.visible = true;
      markerPlaced = true;
      focusBtn.disabled = false;
      if (!elevGrid) {
        elevLine.textContent = 'elevation readout not exported for this dataset (re-export with an elevation grid)';
      } else {
        elevLine.textContent = (h === null || h === undefined || Number.isNaN(h) ? 'outside elevation coverage' : `${h.toFixed(1)} m`)
          + (ll ? ` · ${ll[1].toFixed(5)}°, ${ll[0].toFixed(5)}°` : '');
      }
    } catch (err) {
      console.error('readout failed:', err);
      elevLine.textContent = `readout failed (${err.message}) — see console (F12)`;
    }
  });

  // Shadows default on for desktop, off on small screens; remembered after.
  const chkShadow = el('chkShadow');
  chkShadow.checked = settings.shadow !== undefined
    ? settings.shadow : window.innerWidth > 700;
  const applyShadow = () => {
    hillSun.castShadow = chkShadow.checked;
    persist();
  };
  chkShadow.onchange = applyShadow;
  applyShadow();

  // Apply remembered settings, then reveal.
  if (settings.az) sunAz.value = settings.az;
  if (settings.alt) sunAlt.value = settings.alt;
  updateHillSun();
  if (settings.focal) {
    focal.value = Math.min(200, Math.max(14, Number(settings.focal)));
    applyFocal();
  }
  if (settings.exagg) {
    exagg.value = Math.min(5, Math.max(1, Number(settings.exagg)));
    exagg.dispatchEvent(new Event('input'));
  }
  if (chkBld && settings.bld === false) {
    chkBld.checked = false;
    chkBld.dispatchEvent(new Event('change'));
  }
  if (settings.bldAll === true) {
    el('chkBldAll').checked = true;
    el('chkBldAll').dispatchEvent(new Event('change'));
  }
  setMode(['untextured', 'textured', 'hillshade', 'height'].includes(settings.mode) ? settings.mode : 'textured');
  if (['auto', 'high', 'low'].includes(settings.quality)) {
    quality = settings.quality;
  }
  applyQuality();

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (streamHandle) streamHandle.poke();
    else schedulePump();
  });

  // Perf guard: if frames stay slow with shadows on, drop the shadow map
  // to 1024 once and say so (phones on big scenes).
  let frameEMA = 16, frames = 0, shadowDowngraded = false, lastT = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    frameEMA = frameEMA * 0.95 + (now - lastT) * 0.05;
    lastT = now;
    if (!shadowDowngraded && ++frames > 180 && frameEMA > 50
        && hillSun.castShadow && hillSun.shadow.mapSize.x > 1024) {
      shadowDowngraded = true;
      hillSun.shadow.mapSize.set(1024, 1024);
      if (hillSun.shadow.map) { hillSun.shadow.map.dispose(); hillSun.shadow.map = null; }
      infoEl.innerHTML += `<br><span style="color:#a60">shadows lowered to 1024 (slow device)</span>`;
    }
    controls.update();
    renderer.render(scene, camera);
  });
}

main().catch((e) => {
  showError(`failed: ${e.message}`);
});
