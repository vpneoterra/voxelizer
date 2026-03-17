/**
 * app.js — Main application logic
 * Orchestrates UI state machine, Tripo API client, voxelizer worker, and renderer.
 */

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { TripoClient } from './tripoClient.js';
import { VoxelRenderer } from './voxelRenderer.js';

// ═══════════ CONFIG ═══════════

const DEFAULT_API_KEY = 'tsk_KZcdv4OqQOC0v-SKIVbpi87RfWwmGjfSOFYZonRnouo';

// ═══════════ STATE ═══════════

let currentState = 'IDLE';
let imageFile = null;
let currentResolution = 32;
let surfaceOnly = true;
let geometryBackup = null; // always-valid deep copy for re-voxelization
let currentVoxelPositions = null;
let currentVoxelCount = 0;
let worker = null;
let tripoClient = null;
let renderer = null;
let elapsedInterval = null;
let startTime = 0;

// ═══════════ DOM REFS ═══════════

const $ = (sel) => document.querySelector(sel);
const apiKeyInput       = $('#apiKeyInput');
const dropZone          = $('#dropZone');
const imageInput        = $('#imageInput');
const previewContainer  = $('#previewContainer');
const previewImg        = $('#previewImg');
const previewRemove     = $('#previewRemove');
const generateBtn       = $('#generateBtn');
const glbInput          = $('#glbInput');
const progressSection   = $('#progressSection');
const progressFill      = $('#progressFill');
const progressStages    = $('#progressStages');
const elapsedTimeEl     = $('#elapsedTime');
const errorSection      = $('#errorSection');
const errorMessage      = $('#errorMessage');
const retryBtn          = $('#retryBtn');
const controlsSection   = $('#controlsSection');
const resolutionBtns    = $('#resolutionBtns');
const resolutionValue   = $('#resolutionValue');
const surfaceToggle     = $('#surfaceToggle');
const wireframeToggle   = $('#wireframeToggle');
const autoRotateToggle  = $('#autoRotateToggle');
const screenshotBtn     = $('#screenshotBtn');
const exportBtn         = $('#exportBtn');
const viewportEmpty     = $('#viewportEmpty');
const statsBar          = $('#statsBar');
const statVoxels        = $('#statVoxels');
const statRes           = $('#statRes');
const statFPS           = $('#statFPS');
const viewport          = $('#viewport');

// ═══════════ INIT ═══════════

(function init() {
  // WebGL check
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  if (!gl) {
    viewportEmpty.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:48px;height:48px;color:var(--error)">
        <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
      </svg>
      <p style="color:var(--error)">WebGL 2.0 is not supported. Use Chrome 89+, Firefox 108+, Safari 16.4+, or Edge 89+.</p>`;
    return;
  }

  renderer = new VoxelRenderer(viewport);
  renderer.onFPSUpdate = (fps) => { statFPS.textContent = fps; };
  initTheme();
  bindEvents();
})();

// ═══════════ THEME ═══════════

function initTheme() {
  const toggle = $('[data-theme-toggle]');
  const html = document.documentElement;
  let theme = 'dark';

  toggle.addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', theme);
    toggle.innerHTML = theme === 'dark'
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  });
}

// ═══════════ EVENTS ═══════════

function bindEvents() {
  // Drag & drop
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => { dropZone.classList.remove('drag-over'); });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault(); dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) handleImageFile(e.dataTransfer.files[0]);
  });

  imageInput.addEventListener('change', (e) => { if (e.target.files[0]) handleImageFile(e.target.files[0]); });
  previewRemove.addEventListener('click', resetToIdle);
  generateBtn.addEventListener('click', startGeneration);
  glbInput.addEventListener('change', (e) => { if (e.target.files[0]) handleGLBFile(e.target.files[0]); });
  retryBtn.addEventListener('click', () => { imageFile ? startGeneration() : resetToIdle(); });

  resolutionBtns.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-res]');
    if (!btn) return;
    changeResolution(parseInt(btn.dataset.res));
  });

  surfaceToggle.addEventListener('change', () => {
    surfaceOnly = surfaceToggle.checked;
    if (geometryBackup) revoxelize();
  });
  wireframeToggle.addEventListener('change', () => { renderer?.setWireframe(wireframeToggle.checked); });
  autoRotateToggle.addEventListener('change', () => { renderer?.setAutoRotate(autoRotateToggle.checked); });

  screenshotBtn.addEventListener('click', () => {
    if (!renderer) return;
    const a = document.createElement('a');
    a.href = renderer.takeScreenshot();
    a.download = `voxel-${Date.now()}.png`;
    a.click();
  });

  exportBtn.addEventListener('click', () => {
    if (!renderer || !currentVoxelPositions) return;
    const obj = renderer.exportOBJ(currentVoxelPositions, currentVoxelCount, currentResolution);
    const blob = new Blob([obj], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `voxel-${currentResolution}-${Date.now()}.obj`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

// ═══════════ IMAGE HANDLING ═══════════

function handleImageFile(file) {
  if (!file.type.match(/^image\/(png|jpeg|webp)$/)) {
    showError('Invalid file type. Please upload a PNG, JPG, or WebP image.');
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    showError('File too large. Maximum size is 20 MB.');
    return;
  }

  cancelCurrentOp();
  imageFile = file;

  const reader = new FileReader();
  reader.onload = (e) => {
    previewImg.src = e.target.result;
    previewContainer.classList.add('visible');
    dropZone.style.display = 'none';
    setState('IMAGE_LOADED');
  };
  reader.readAsDataURL(file);
}

// ═══════════ GLB / OBJ DIRECT LOAD ═══════════

async function handleGLBFile(file) {
  cancelCurrentOp();
  const ext = file.name.split('.').pop().toLowerCase();
  const buffer = await file.arrayBuffer();

  setProgressVisible(true);
  resetStages();
  updateStage('upload', 'done');
  updateStage('generate', 'done');
  updateStage('download', 'done');

  try {
    let scene;
    if (ext === 'obj') {
      const text = new TextDecoder().decode(buffer);
      scene = new OBJLoader().parse(text);
    } else {
      const gltf = await parseGLB(buffer);
      scene = gltf.scene;
    }

    const geo = extractAndStore(scene);
    if (!geo) throw new Error('No valid geometry found in the file.');
    await voxelize();
  } catch (err) {
    showError(err.message);
  }
}

// ═══════════ TRIPO GENERATION PIPELINE ═══════════

async function startGeneration() {
  if (!imageFile) return;

  const apiKey = apiKeyInput.value.trim() || DEFAULT_API_KEY;
  if (!apiKey) { showError('Please enter your Tripo AI API key.'); return; }

  cancelCurrentOp();
  setState('UPLOADING');
  setProgressVisible(true);
  resetStages();
  startElapsedTimer();

  tripoClient = new TripoClient(apiKey);

  try {
    const glbBuffer = await tripoClient.generateFromImage(imageFile, (stage, status) => {
      updateStage(stage, status === 'active' ? 'active' : 'done');
    });

    updateStage('download', 'done');
    const gltf = await parseGLB(glbBuffer);
    const geo = extractAndStore(gltf.scene);
    if (!geo) throw new Error('No geometry found in generated model.');
    await voxelize();
  } catch (err) {
    if (err.name === 'AbortError') return;
    showError(err.message);
  }
}

function parseGLB(buffer) {
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(buffer, '', resolve, reject);
  });
}

// ═══════════ GEOMETRY EXTRACTION ═══════════

/**
 * Walk a Three.js scene, find the largest mesh, deep-copy its geometry data,
 * and store it in geometryBackup for repeated voxelization.
 */
function extractAndStore(scene) {
  let bestPos = null, bestCol = null, bestIdx = null, maxVerts = 0;

  scene.traverse((child) => {
    if (!child.isMesh || !child.geometry) return;
    const posAttr = child.geometry.getAttribute('position');
    if (!posAttr || posAttr.count <= maxVerts) return;

    maxVerts = posAttr.count;
    bestPos = new Float32Array(posAttr.array);
    bestIdx = child.geometry.index ? new Uint32Array(child.geometry.index.array) : null;

    const colAttr = child.geometry.getAttribute('color');
    bestCol = colAttr ? new Float32Array(colAttr.array) : null;
  });

  if (!bestPos) { geometryBackup = null; return null; }

  geometryBackup = { positions: bestPos, colors: bestCol, indices: bestIdx };
  return geometryBackup;
}

// ═══════════ VOXELIZATION ═══════════

function voxelize() {
  if (!geometryBackup) return Promise.reject(new Error('No geometry'));

  updateStage('voxelize', 'active');

  return new Promise((resolve, reject) => {
    if (worker) worker.terminate();
    worker = new Worker('./voxelizer.js');

    worker.onmessage = (e) => {
      const msg = e.data;

      if (msg.type === 'progress') {
        progressFill.style.width = `${Math.min(80 + msg.progress * 0.2, 100)}%`;
        progressFill.classList.remove('indeterminate');
      }

      if (msg.type === 'result') {
        updateStage('voxelize', 'done');
        updateStage('render', 'active');

        currentVoxelPositions = msg.positions;
        currentVoxelCount = msg.count;

        if (msg.count === 0) {
          if (currentResolution > 16) { changeResolution(currentResolution / 2); resolve(); return; }
          showError('Voxelization produced zero voxels. The mesh may be too small or malformed.');
          reject(new Error('Zero voxels'));
          return;
        }

        renderer.setVoxels(msg.positions, msg.colors, msg.count, currentResolution);
        updateStage('render', 'done');
        setState('RENDERING');
        stopElapsedTimer();
        setProgressVisible(false);
        showControls(true);
        showStats(true);
        statVoxels.textContent = msg.count.toLocaleString();
        statRes.textContent = `${currentResolution}³`;
        resolve();
      }

      if (msg.type === 'error') reject(new Error(msg.message));
    };

    worker.onerror = (err) => reject(new Error(err.message));

    // Send copies via structured clone (not transfer, so backup stays valid)
    const posCopy = new Float32Array(geometryBackup.positions);
    const colCopy = geometryBackup.colors ? new Float32Array(geometryBackup.colors) : null;
    const idxCopy = geometryBackup.indices ? new Uint32Array(geometryBackup.indices) : null;

    worker.postMessage({
      positions: posCopy,
      colors: colCopy,
      indices: idxCopy,
      resolution: currentResolution,
      mode: surfaceOnly ? 'surface' : 'filled'
    });
  });
}

function revoxelize() {
  showControls(false);
  setProgressVisible(true);
  resetStages();
  updateStage('upload', 'done');
  updateStage('generate', 'done');
  updateStage('download', 'done');
  voxelize().catch(err => showError(err.message));
}

function changeResolution(res) {
  currentResolution = res;
  resolutionValue.textContent = res;
  resolutionBtns.querySelectorAll('button').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.res) === res);
  });
  if (geometryBackup) revoxelize();
}

// ═══════════ UI STATE ═══════════

function setState(state) {
  currentState = state;
  generateBtn.disabled = state !== 'IMAGE_LOADED';
}

function resetToIdle() {
  cancelCurrentOp();
  imageFile = null;
  previewImg.src = '';
  previewContainer.classList.remove('visible');
  dropZone.style.display = '';
  setProgressVisible(false);
  errorSection.classList.remove('visible');
  showControls(false);
  showStats(false);
  renderer?.clearVoxels();
  viewportEmpty.style.display = '';
  geometryBackup = null;
  currentVoxelPositions = null;
  currentVoxelCount = 0;
  setState('IDLE');
  imageInput.value = '';
  glbInput.value = '';
}

function cancelCurrentOp() {
  tripoClient?.cancel();
  if (worker) { worker.terminate(); worker = null; }
  stopElapsedTimer();
}

// ═══════════ UI HELPERS ═══════════

function setProgressVisible(visible) {
  progressSection.classList.toggle('visible', visible);
  if (visible) {
    viewportEmpty.style.display = 'none';
    errorSection.classList.remove('visible');
    progressFill.style.width = '0%';
  }
}

function resetStages() {
  progressStages.querySelectorAll('.progress-stage').forEach(el => {
    el.className = 'progress-stage';
    el.querySelector('.stage-icon').innerHTML = '';
  });
}

function updateStage(stage, status) {
  const el = progressStages.querySelector(`[data-stage="${stage}"]`);
  if (!el) return;
  el.className = `progress-stage ${status}`;
  const icon = el.querySelector('.stage-icon');

  const stageProgress = { upload: 10, generate: 30, download: 60, voxelize: 80, render: 95 };

  if (status === 'active') {
    icon.innerHTML = '<div class="spinner"></div>';
    progressFill.style.width = `${stageProgress[stage] || 0}%`;
    progressFill.classList.toggle('indeterminate', stage === 'generate');
  } else if (status === 'done') {
    icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>';
  } else if (status === 'error') {
    icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  }
}

function showError(msg) {
  setState('ERROR');
  stopElapsedTimer();
  setProgressVisible(false);
  errorSection.classList.add('visible');
  errorMessage.textContent = msg;
}

function showControls(v) { controlsSection.classList.toggle('visible', v); }
function showStats(v)    { statsBar.classList.toggle('visible', v); }

function startElapsedTimer() {
  startTime = Date.now();
  stopElapsedTimer();
  elapsedInterval = setInterval(() => {
    const s = Math.floor((Date.now() - startTime) / 1000);
    elapsedTimeEl.textContent = s >= 60 ? `${Math.floor(s/60)}m ${s%60}s elapsed` : `${s}s elapsed`;
  }, 1000);
}

function stopElapsedTimer() {
  if (elapsedInterval) { clearInterval(elapsedInterval); elapsedInterval = null; }
}
