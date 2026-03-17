/**
 * voxelizer.js — Web Worker for mesh-to-voxel conversion
 * Receives geometry data from main thread, returns voxel grid.
 * 
 * Implements two modes:
 *  1. Surface sampling (default) — fast, barycentric sampling on triangles
 *  2. Raycasting (filled) — slower, 6-axis raycasting for solid interiors
 */

self.onmessage = function(e) {
  const { positions, normals, colors, uvs, indices, resolution, mode } = e.data;

  try {
    const triangles = buildTriangles(positions, normals, colors, indices);

    let voxels;
    if (mode === 'filled') {
      voxels = voxelizeRaycast(triangles, resolution, (pct) => {
        self.postMessage({ type: 'progress', progress: pct });
      });
    } else {
      voxels = voxelizeSurface(triangles, resolution, (pct) => {
        self.postMessage({ type: 'progress', progress: pct });
      });
    }

    // Pack into typed arrays for efficient transfer
    const count = voxels.length;
    const posArray = new Float32Array(count * 3);
    const colorArray = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      posArray[i * 3]     = voxels[i].x;
      posArray[i * 3 + 1] = voxels[i].y;
      posArray[i * 3 + 2] = voxels[i].z;
      colorArray[i * 3]     = voxels[i].r;
      colorArray[i * 3 + 1] = voxels[i].g;
      colorArray[i * 3 + 2] = voxels[i].b;
    }

    self.postMessage({
      type: 'result',
      positions: posArray,
      colors: colorArray,
      count
    }, [posArray.buffer, colorArray.buffer]);

  } catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  }
};

// ═══════════ TRIANGLE HELPERS ═══════════

function buildTriangles(positions, normals, colors, indices) {
  const tris = [];
  // Handle both TypedArray and ArrayBuffer inputs
  const posArr = positions instanceof Float32Array ? positions : new Float32Array(positions);
  const colArr = colors ? (colors instanceof Float32Array ? colors : new Float32Array(colors)) : null;
  const hasIndices = indices && (indices.length || indices.byteLength) > 0;
  const idxArr = hasIndices ? (indices instanceof Uint32Array ? indices : new Uint32Array(indices)) : null;
  const triCount = hasIndices ? idxArr.length / 3 : posArr.length / 9;

  for (let t = 0; t < triCount; t++) {
    const i0 = hasIndices ? idxArr[t * 3] : t * 3;
    const i1 = hasIndices ? idxArr[t * 3 + 1] : t * 3 + 1;
    const i2 = hasIndices ? idxArr[t * 3 + 2] : t * 3 + 2;

    const tri = {
      v0: [posArr[i0*3], posArr[i0*3+1], posArr[i0*3+2]],
      v1: [posArr[i1*3], posArr[i1*3+1], posArr[i1*3+2]],
      v2: [posArr[i2*3], posArr[i2*3+1], posArr[i2*3+2]],
      c0: colArr ? [colArr[i0*3], colArr[i0*3+1], colArr[i0*3+2]] : [0.65, 0.65, 0.7],
      c1: colArr ? [colArr[i1*3], colArr[i1*3+1], colArr[i1*3+2]] : [0.65, 0.65, 0.7],
      c2: colArr ? [colArr[i2*3], colArr[i2*3+1], colArr[i2*3+2]] : [0.65, 0.65, 0.7]
    };
    tris.push(tri);
  }
  return tris;
}

// ═══════════ SURFACE SAMPLING (default) ═══════════

function voxelizeSurface(triangles, resolution, onProgress) {
  // Compute bounding box
  const bbox = computeBBox(triangles);
  const size = Math.max(bbox.max[0]-bbox.min[0], bbox.max[1]-bbox.min[1], bbox.max[2]-bbox.min[2]);
  const center = [
    (bbox.min[0]+bbox.max[0])/2,
    (bbox.min[1]+bbox.max[1])/2,
    (bbox.min[2]+bbox.max[2])/2
  ];

  const voxelMap = new Map();
  const N = resolution;
  // Samples per triangle scales with resolution — denser for better coverage
  const samplesPerTri = Math.max(8, Math.ceil((N * N * 3) / triangles.length));

  for (let t = 0; t < triangles.length; t++) {
    if (t % 500 === 0) {
      onProgress(Math.floor((t / triangles.length) * 100));
    }

    const tri = triangles[t];
    // Adaptive: more samples for larger triangles
    const area = triangleArea(tri.v0, tri.v1, tri.v2);
    const voxelSize = size / N;
    const areaInVoxels = area / (voxelSize * voxelSize);
    const numSamples = Math.max(samplesPerTri, Math.ceil(areaInVoxels * 2));

    for (let s = 0; s < numSamples; s++) {
      // Random barycentric coords
      let u = Math.random();
      let v = Math.random();
      if (u + v > 1) { u = 1 - u; v = 1 - v; }
      const w = 1 - u - v;

      const px = tri.v0[0]*u + tri.v1[0]*v + tri.v2[0]*w;
      const py = tri.v0[1]*u + tri.v1[1]*v + tri.v2[1]*w;
      const pz = tri.v0[2]*u + tri.v1[2]*v + tri.v2[2]*w;

      // Map to voxel grid
      const gx = Math.floor(((px - center[0]) / size + 0.5) * N);
      const gy = Math.floor(((py - center[1]) / size + 0.5) * N);
      const gz = Math.floor(((pz - center[2]) / size + 0.5) * N);

      if (gx < 0 || gx >= N || gy < 0 || gy >= N || gz < 0 || gz >= N) continue;

      const key = `${gx},${gy},${gz}`;
      if (!voxelMap.has(key)) {
        const cr = tri.c0[0]*u + tri.c1[0]*v + tri.c2[0]*w;
        const cg = tri.c0[1]*u + tri.c1[1]*v + tri.c2[1]*w;
        const cb = tri.c0[2]*u + tri.c1[2]*v + tri.c2[2]*w;
        voxelMap.set(key, {
          x: gx - N/2, y: gy - N/2, z: gz - N/2,
          r: cr, g: cg, b: cb
        });
      }
    }
  }

  onProgress(100);
  return Array.from(voxelMap.values());
}

// ═══════════ RAYCASTING (filled volume) ═══════════

function voxelizeRaycast(triangles, resolution, onProgress) {
  const bbox = computeBBox(triangles);
  const size = Math.max(bbox.max[0]-bbox.min[0], bbox.max[1]-bbox.min[1], bbox.max[2]-bbox.min[2]);
  const center = [
    (bbox.min[0]+bbox.max[0])/2,
    (bbox.min[1]+bbox.max[1])/2,
    (bbox.min[2]+bbox.max[2])/2
  ];

  const N = resolution;
  const half = size / 2;
  const step = size / N;

  // Simple spatial hash for triangles
  const grid = new Uint8Array(N * N * N);
  // Color accumulator
  const colorR = new Float32Array(N * N * N);
  const colorG = new Float32Array(N * N * N);
  const colorB = new Float32Array(N * N * N);
  const colorCount = new Uint16Array(N * N * N);

  // First pass: surface voxels (fast, to get colors)
  const surfaceVoxels = voxelizeSurface(triangles, resolution, () => {});
  for (const v of surfaceVoxels) {
    const gx = v.x + N/2;
    const gy = v.y + N/2;
    const gz = v.z + N/2;
    if (gx >= 0 && gx < N && gy >= 0 && gy < N && gz >= 0 && gz < N) {
      const idx = gx + gy * N + gz * N * N;
      grid[idx] = 1;
      colorR[idx] = v.r;
      colorG[idx] = v.g;
      colorB[idx] = v.b;
      colorCount[idx] = 1;
    }
  }

  // Second pass: fill interior using 6-axis raycasting
  let processed = 0;
  const total = N * N;

  for (let a = 0; a < N; a++) {
    for (let b = 0; b < N; b++) {
      if (processed % 100 === 0) {
        onProgress(Math.floor((processed / total) * 100));
      }
      processed++;

      // Ray along Z axis
      fillRaySegments(grid, N, a, b, 'z');
      // Ray along X axis
      fillRaySegments(grid, N, a, b, 'x');
      // Ray along Y axis
      fillRaySegments(grid, N, a, b, 'y');
    }
  }

  // Collect filled voxels
  const result = [];
  const avgColor = surfaceVoxels.length > 0
    ? surfaceVoxels.reduce((acc, v) => [acc[0]+v.r, acc[1]+v.g, acc[2]+v.b], [0,0,0]).map(c => c / surfaceVoxels.length)
    : [0.65, 0.65, 0.7];

  for (let z = 0; z < N; z++) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const idx = x + y * N + z * N * N;
        if (grid[idx]) {
          result.push({
            x: x - N/2, y: y - N/2, z: z - N/2,
            r: colorCount[idx] > 0 ? colorR[idx] : avgColor[0],
            g: colorCount[idx] > 0 ? colorG[idx] : avgColor[1],
            b: colorCount[idx] > 0 ? colorB[idx] : avgColor[2]
          });
        }
      }
    }
  }

  onProgress(100);
  return result;
}

function fillRaySegments(grid, N, a, b, axis) {
  // Scan along one axis. Mark cells between surface boundaries as filled.
  let inside = false;
  const getIdx = (i) => {
    switch(axis) {
      case 'z': return a + b * N + i * N * N;
      case 'x': return i + a * N + b * N * N;
      case 'y': return a + i * N + b * N * N;
    }
  };

  // Find surface entries along the ray
  const surfaces = [];
  for (let i = 0; i < N; i++) {
    if (grid[getIdx(i)] === 1) surfaces.push(i);
  }

  // Fill between pairs of surface voxels
  for (let s = 0; s < surfaces.length - 1; s += 2) {
    for (let i = surfaces[s]; i <= surfaces[s + 1]; i++) {
      const idx = getIdx(i);
      if (!grid[idx]) grid[idx] = 2; // interior
    }
  }
}

// ═══════════ UTILITIES ═══════════

function computeBBox(triangles) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const tri of triangles) {
    for (const v of [tri.v0, tri.v1, tri.v2]) {
      min[0] = Math.min(min[0], v[0]);
      min[1] = Math.min(min[1], v[1]);
      min[2] = Math.min(min[2], v[2]);
      max[0] = Math.max(max[0], v[0]);
      max[1] = Math.max(max[1], v[1]);
      max[2] = Math.max(max[2], v[2]);
    }
  }
  return { min, max };
}

function triangleArea(v0, v1, v2) {
  const ax = v1[0]-v0[0], ay = v1[1]-v0[1], az = v1[2]-v0[2];
  const bx = v2[0]-v0[0], by = v2[1]-v0[1], bz = v2[2]-v0[2];
  const cx = ay*bz - az*by;
  const cy = az*bx - ax*bz;
  const cz = ax*by - ay*bx;
  return 0.5 * Math.sqrt(cx*cx + cy*cy + cz*cz);
}
