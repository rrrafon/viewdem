import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/GLTFLoader.js';

// stream.js -- multi-resolution streaming loader (plan_streaming.md §8.3).
//
// Owns data/policy/queue/visibility for tileset pyramids. All three.js
// scene mutation for tile *content* (materials, shadows) stays in main.js
// via the buildTileContent hook, so modes/exaggeration/readout keep working
// through the existing terrainGroup traversal.
//
// Switch semantics (tileset): switchMeters[i] = refine past level i when
// camera distance drops below it. Coarsening uses a 1.25x hysteresis band
// plus delayed eviction so fast orbits don't thrash.

const MAX_CONCURRENT = 4;
const MAX_TILES = 24; // LRU eviction past this many resident refined tiles
const COARSEN_BAND = 1.25;
const RETRY_MS = 5000;

export async function startStreaming(env) {
  const {
    manifest, basePath, camera, controls, scaleGroup, terrainGroup,
    buildingsGroup, buildTileContent, getMaxDetail,
    loadLabel, loadBar, loadEl, infoEl,
  } = env;

  const gltfLoader = new GLTFLoader();
  const texLoader = new THREE.TextureLoader();

  const res = await fetch(basePath + manifest.streaming);
  if (!res.ok) throw new Error(`tileset ${manifest.streaming}: HTTP ${res.status}`);
  const tileset = await res.json();
  const dir = basePath + manifest.streaming.split('/').slice(0, -1).join('/');

  // Tileset meshes are origin-relative to tileset.origin, which can differ
  // slightly from manifest.origin (separate meshing runs). Shift content so
  // it lands in the manifest frame that scaleGroup recentres.
  const mOx = (manifest.origin && manifest.origin[0]) || 0;
  const mOy = (manifest.origin && manifest.origin[1]) || 0;
  const tOx = (tileset.origin && tileset.origin[0]) || 0;
  const tOy = (tileset.origin && tileset.origin[1]) || 0;
  const shiftX = tOx - mOx, shiftY = tOy - mOy;

  const statusEl = document.createElement('div');
  infoEl.appendChild(statusEl);
  const setStatus = () => {
    const counts = levels.filter((l) => l.detail > 0).map((l) => {
      const got = l.tiles.filter((t) => t.status === 'loaded').length;
      const bad = l.tiles.filter((t) => t.status === 'error').length;
      return `L${l.detail} ${got}/${l.tiles.length}${bad ? ` (err ${bad})` : ''}`;
    }).join(' · ');
    const l0err = l0.status === 'error' ? ` (err ×${l0.fails})` : '';
    statusEl.textContent = `stream L0 ${l0.status}${l0err} · ${counts} · target L${target}`;
  };

  // ---- records ----
  const boxOf = (b, z0, z1) => new THREE.Box3(
    new THREE.Vector3(b[0] - tOx, b[1] - tOy, z0),
    new THREE.Vector3(b[2] - tOx, b[3] - tOy, z1));
  // Z range for culling boxes: reuse the framed scene box when available.
  const z0 = env.zRange ? env.zRange[0] : -100;
  const z1 = env.zRange ? env.zRange[1] : 2000;

  const levels = (tileset.levels || []).map((lv) => ({
    detail: lv.detail,
    switchMeters: lv.switchMeters,
    tiles: (lv.tiles || []).map((t) => ({
      level: lv.detail, row: t.row, col: t.col,
      file: t.file, texture: t.texture, box: boxOf(t.bounds, z0, z1),
      status: 'idle', group: null, lastUsed: 0, fails: 0, ctrl: null,
    })),
  })).sort((a, b) => a.detail - b.detail);
  const maxDetail = Math.max(...levels.map((l) => l.detail));
  const levelOf = (d) => levels.find((l) => l.detail === d);

  const l0info = (tileset.levels || []).find((l) => l.detail === 0);
  const l0 = {
    status: 'idle', group: null, fails: 0, ctrl: null, lastUsed: 0,
    box: l0info ? boxOf(l0info.bounds, z0, z1) : null,
  };

  const worldBoxOf = (box) => {
    const k = scaleGroup.scale.z || 1;
    const sx = scaleGroup.position.x + shiftX, sy = scaleGroup.position.y + shiftY;
    return new THREE.Box3(
      new THREE.Vector3(box.min.x + sx, box.min.y + sy, Math.min(box.min.z, box.max.z) * k),
      new THREE.Vector3(box.max.x + sx, box.max.y + sy, Math.max(box.min.z, box.max.z) * k));
  };

  let target = l0info ? 0 : 1; // no L0 (step 2b pending) -> start at first real level
  let firstPaint = false;
  let activeLoads = 0;
  let retryTimer = null;
  const scheduleRetry = () => {
    if (retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      pumpAndBuildings();
    }, RETRY_MS + 500);
  };
  const frustum = new THREE.Frustum();
  const projMat = new THREE.Matrix4();
  const inFrustum = (rec) => {
    if (!rec.box) return true;
    camera.updateMatrixWorld();
    projMat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projMat);
    return frustum.intersectsBox(worldBoxOf(rec.box));
  };
  const orbitDist = () => camera.position.distanceTo(controls.target);

  // ---- loading ----
  const fetchTile = async (rec, url, texUrl) => {
    const ctrl = new AbortController();
    rec.ctrl = ctrl;
    activeLoads++;
    try {
      const r = await fetch(url, { signal: ctrl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = await r.arrayBuffer();
      // parseAsync resolves to the glTF container; unwrap like loadAsync.
      const parsed = await gltfLoader.parseAsync(buf, dir + '/');
      const obj = (parsed && parsed.scene) || parsed;
      const tex = texUrl ? await texLoader.loadAsync(texUrl) : null;
      return buildTileContent(obj, tex);
    } finally {
      activeLoads--;
      if (rec.ctrl === ctrl) rec.ctrl = null;
    }
  };

  const finishFirstPaint = () => {
    if (!firstPaint) {
      firstPaint = true;
      loadEl.style.display = 'none';
    }
  };

  const loadRec = async (rec, url, texUrl, isL0) => {
    rec.status = 'loading';
    if (!isL0) {
      loadLabel.textContent = `stream ${url.split('/').pop()} (${activeLoads}/${MAX_CONCURRENT})`;
    }
    try {
      const group = await fetchTile(rec, url, texUrl);
      group.position.set(shiftX, shiftY, 0);
      group.visible = false;
      terrainGroup.add(group);
      rec.group = group;
      rec.status = 'loaded';
      rec.lastUsed = performance.now();
      if (isL0) {
        group.visible = true;
      }
      // First shown tile paints (normally L0; a refined tile if L0 died).
      if (!firstPaint) finishFirstPaint();
    } catch (e) {
      if (e && e.name === 'AbortError') {
        rec.status = 'idle';
      } else {
        console.warn(`stream tile failed: ${url}`, e);
        rec.fails++;
        if (isL0 && rec.fails >= 2) {
          // Don't let a bad base block the scene: refined tiles cover it.
          rec.status = 'dead';
          loadLabel.textContent = 'stream base failed — refining without it';
        } else {
          rec.status = 'error';
          rec.retryAt = performance.now() + RETRY_MS;
          loadLabel.textContent = `stream ${url.split('/').pop()} failed (${e?.message || e}) — retrying`;
        }
        scheduleRetry();
      }
    }
    setStatus();
    pumpAndBuildings();
  };

  const disposeRec = (rec) => {
    if (!rec.group) return;
    terrainGroup.remove(rec.group);
    rec.group.traverse((child) => {
      if (!child.isMesh) return;
      child.geometry.dispose();
      if (child.material && child.material === child.userData.texturedMat) {
        if (child.material.map) child.material.map.dispose();
        child.material.dispose();
      }
    });
    rec.group = null;
    rec.status = 'idle';
  };

  // ---- policy ----
  // Child mapping assumes each level doubles the previous grid (2x2 -> 4x4),
  // which export_stream.py guarantees via integer-multiple nesting.
  const childrenOf = (rec) => {
    if (rec === l0) return (levelOf(1)?.tiles || []);
    const lv = levelOf(rec.level + 1);
    if (!lv) return [];
    return lv.tiles.filter((t) => Math.floor(t.row / 2) === rec.row
      && Math.floor(t.col / 2) === rec.col);
  };

  const updateTarget = () => {
    const d = orbitDist();
    const cap = Math.min(getMaxDetail(), maxDetail);
    let t = Math.min(target, cap);
    const sw = (i) => levelOf(i)?.switchMeters;
    while (t < cap && sw(t) !== undefined && d < sw(t)) t++;
    while (t > 0 && sw(t - 1) !== undefined && d > sw(t - 1) * COARSEN_BAND) t--;
    target = Math.min(t, cap);
  };

  const visibleMap = new Map(); // rec -> bool, finest-first
  const updateVisibility = () => {
    visibleMap.clear();
    const consider = [];
    if (l0.group) consider.push(l0);
    for (let d = maxDetail; d >= 1; d--) {
      for (const t of (levelOf(d)?.tiles || [])) {
        if (t.group) consider.push(t);
      }
    }
    // Finest level first so parents can read children's state.
    consider.sort((a, b) => (b === l0 ? -1 : b.level) - (a === l0 ? -1 : a.level));
    for (const rec of consider) {
      const lv = rec === l0 ? 0 : rec.level;
      let vis = rec.status === 'loaded' && lv <= target && inFrustum(rec);
      if (vis && lv < target) {
        const kids = childrenOf(rec).filter((k) => inFrustum(k));
        if (kids.length && kids.every((k) => visibleMap.get(k))) vis = false;
      }
      visibleMap.set(rec, vis);
      if (rec.group) {
        rec.group.visible = vis;
        if (vis) rec.lastUsed = performance.now();
      }
    }
  };

  const pump = () => {
    updateTarget();
    const want = [];
    if (l0info) {
      if (l0.status === 'idle') {
        want.push({ rec: l0, isL0: true, pri: -Infinity });
      } else if (l0.status === 'error' && performance.now() > (l0.retryAt || 0) && l0.fails < 2) {
        l0.status = 'idle';
        want.push({ rec: l0, isL0: true, pri: -Infinity });
      }
    }
    for (let d = 1; d <= target; d++) {
      for (const t of (levelOf(d)?.tiles || [])) {
        if (t.status === 'error') {
          if (t.fails < 2 && performance.now() > (t.retryAt || 0)) t.status = 'idle';
          else continue;
        }
        if (t.status !== 'idle' || !inFrustum(t)) continue;
        const c = t.box.getCenter(new THREE.Vector3());
        const dist = camera.position.distanceTo(new THREE.Vector3(
          c.x + scaleGroup.position.x + shiftX, c.y + scaleGroup.position.y + shiftY, c.z));
        const size = Math.max(t.box.max.x - t.box.min.x, t.box.max.y - t.box.min.y);
        want.push({ rec: t, isL0: false, pri: d * 1e9 - size / Math.max(dist, 1) });
      }
    }
    want.sort((a, b) => a.pri - b.pri);
    for (const { rec, isL0 } of want) {
      if (activeLoads >= MAX_CONCURRENT) break;
      if (rec.status !== 'idle') continue;
      const info = isL0 ? l0info : null;
      const url = isL0 ? dir + '/' + info.mesh : dir + '/' + rec.file;
      const tex = isL0 ? (info.texture ? dir + '/' + info.texture : null)
        : (rec.texture ? dir + '/' + rec.texture : null);
      loadRec(rec, url, tex, isL0);
    }
    // Abort in-flight loads that are no longer wanted.
    const abortStale = (rec, isL0) => {
      if (rec.status !== 'loading' || !rec.ctrl) return;
      const needed = isL0 ? true
        : (rec.level <= target && inFrustum(rec));
      if (!needed) rec.ctrl.abort();
    };
    abortStale(l0, true);
    for (const lv of levels) for (const t of lv.tiles) abortStale(t, false);
    updateVisibility();
    evict();
    setStatus();
  };

  const evict = () => {
    const resident = [];
    for (const lv of levels) {
      for (const t of lv.tiles) {
        if (t.status === 'loaded' && t.level > target) resident.push(t);
      }
    }
    resident.sort((a, b) => a.lastUsed - b.lastUsed);
    let over = levels.flatMap((l) => l.tiles)
      .filter((t) => t.status === 'loaded').length - MAX_TILES;
    for (const t of resident) {
      if (over <= 0) break;
      if (t.status === 'loading') continue;
      disposeRec(t);
      over--;
    }
    // Keep the status line fresh even without loads.
    updateVisibility();
  };

  let pumpTimer = null;
  const poke = () => {
    if (pumpTimer) return;
    pumpTimer = setTimeout(() => { pumpTimer = null; pumpAndBuildings(); }, 150);
  };

  // ---- buildings (v1: single file, shown once refined detail is on screen)
  let buildingsState = 'idle';
  const bUrl = tileset.buildings && tileset.buildings.file
    ? basePath + tileset.buildings.file : null;
  const pumpBuildings = async () => {
    const atRefined = target >= (tileset.buildings?.level ?? maxDetail);
    const showAll = document.getElementById('chkBldAll')?.checked === true;
    const want = (atRefined || showAll)
      && document.getElementById('chkBld')?.checked !== false;
    if (!bUrl || buildingsState === 'loaded') {
      buildingsGroup.visible = buildingsState === 'loaded' && want;
      return;
    }
    if (!want || buildingsState === 'loading') return;
    buildingsState = 'loading';
    try {
      const r = await fetch(bUrl);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const parsed = await gltfLoader.parseAsync(await r.arrayBuffer(), basePath);
      env.buildBuildings((parsed && parsed.scene) || parsed);
      buildingsState = 'loaded';
      buildingsGroup.visible = want;
    } catch (e) {
      console.warn('stream buildings failed:', e);
      buildingsState = 'idle';
    }
  };

  const pumpAndBuildings = () => { pump(); pumpBuildings(); };

  controls.addEventListener('change', poke);
  loadLabel.textContent = 'stream base (L0)…';
  loadBar.style.width = '5%';
  pumpAndBuildings();

  return {
    poke: pumpAndBuildings,
    getTarget: () => target,
    dispose: () => {
      controls.removeEventListener('change', poke);
      if (l0.group) disposeRec(l0);
      for (const lv of levels) for (const t of lv.tiles) {
        if (t.ctrl) t.ctrl.abort();
        if (t.group) disposeRec(t);
      }
    },
  };
}
