/**
 * voxelRenderer.js — Three.js voxel rendering module
 * Uses InstancedMesh for performant voxel display.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class VoxelRenderer {
  constructor(container) {
    this.container = container;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.voxelMesh = null;
    this.wireframeMesh = null;
    this.animationId = null;
    this.showWireframe = false;
    this.autoRotate = true;
    this.voxelCount = 0;
    this.resolution = 0;
    this.clock = new THREE.Clock();
    this.fpsFrames = 0;
    this.fpsTime = 0;
    this.currentFPS = 60;
    this.onFPSUpdate = null;

    this._init();
  }

  _init() {
    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true // needed for screenshots
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.container.appendChild(this.renderer.domElement);

    // Scene
    this.scene = new THREE.Scene();

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      50,
      this.container.clientWidth / this.container.clientHeight,
      0.1,
      1000
    );
    this.camera.position.set(2, 1.5, 2);

    // Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 1.5;
    this.controls.maxDistance = 10;
    this.controls.minDistance = 0.5;

    // Stop auto-rotate on user interaction
    this.controls.addEventListener('start', () => {
      if (this.autoRotate) {
        this.controls.autoRotate = false;
        // Resume after 3s of inactivity
        clearTimeout(this._rotateTimeout);
        this._rotateTimeout = setTimeout(() => {
          if (this.autoRotate) this.controls.autoRotate = true;
        }, 3000);
      }
    });

    // Lighting
    const dirLight = new THREE.DirectionalLight(0xfff5e6, 1.2);
    dirLight.position.set(5, 8, 5);
    this.scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0xe6f0ff, 0.4);
    fillLight.position.set(-3, 2, -5);
    this.scene.add(fillLight);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambientLight);

    // Subtle ground grid
    this._addGroundGrid();

    // Resize observer
    this._resizeObserver = new ResizeObserver(() => this._onResize());
    this._resizeObserver.observe(this.container);

    // Start render loop
    this._animate();
  }

  _addGroundGrid() {
    const gridHelper = new THREE.GridHelper(4, 20, 0x444466, 0x333350);
    gridHelper.position.y = -1.5;
    gridHelper.material.transparent = true;
    gridHelper.material.opacity = 0.2;
    this.scene.add(gridHelper);
    this.gridHelper = gridHelper;
  }

  _onResize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  _animate() {
    this.animationId = requestAnimationFrame(() => this._animate());
    const delta = this.clock.getDelta();

    this.controls.update();

    // FPS calculation
    this.fpsFrames++;
    this.fpsTime += delta;
    if (this.fpsTime >= 0.5) {
      this.currentFPS = Math.round(this.fpsFrames / this.fpsTime);
      this.fpsFrames = 0;
      this.fpsTime = 0;
      this.onFPSUpdate?.(this.currentFPS);
    }

    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Display voxels from position/color arrays
   * @param {Float32Array} positions - flat [x,y,z,...] 
   * @param {Float32Array} colors - flat [r,g,b,...] 
   * @param {number} count - number of voxels
   * @param {number} resolution - grid resolution
   */
  setVoxels(positions, colors, count, resolution) {
    this.clearVoxels();
    this.voxelCount = count;
    this.resolution = resolution;

    if (count === 0) return;

    const voxelSize = 2.0 / resolution; // normalize to ~2 unit cube
    const geometry = new THREE.BoxGeometry(voxelSize, voxelSize, voxelSize);
    const material = new THREE.MeshStandardMaterial({
      roughness: 0.65,
      metalness: 0.05,
      flatShading: true,
      vertexColors: false
    });

    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    for (let i = 0; i < count; i++) {
      dummy.position.set(
        positions[i * 3] * voxelSize,
        positions[i * 3 + 1] * voxelSize,
        positions[i * 3 + 2] * voxelSize
      );
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      color.setRGB(colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2]);
      mesh.setColorAt(i, color);
    }

    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    this.scene.add(mesh);
    this.voxelMesh = mesh;

    // Create wireframe version (hidden by default)
    this._buildWireframe(positions, count, voxelSize);

    // Fit camera to model
    this._fitCamera();

    // Position grid below the model
    this.gridHelper.position.y = -(resolution / 2 * voxelSize) - 0.1;
  }

  _buildWireframe(positions, count, voxelSize) {
    const edgeGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(voxelSize, voxelSize, voxelSize));
    const edgeMat = new THREE.LineBasicMaterial({
      color: 0x888899,
      transparent: true,
      opacity: 0.15
    });

    // For performance, only show wireframe up to ~8000 voxels
    const maxWire = Math.min(count, 8000);
    const wireGroup = new THREE.Group();

    for (let i = 0; i < maxWire; i++) {
      const line = new THREE.LineSegments(edgeGeo, edgeMat);
      line.position.set(
        positions[i * 3] * voxelSize,
        positions[i * 3 + 1] * voxelSize,
        positions[i * 3 + 2] * voxelSize
      );
      wireGroup.add(line);
    }

    wireGroup.visible = this.showWireframe;
    this.scene.add(wireGroup);
    this.wireframeMesh = wireGroup;
  }

  _fitCamera() {
    if (!this.voxelMesh) return;

    const box = new THREE.Box3().setFromObject(this.voxelMesh);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const dist = maxDim * 1.8;

    this.camera.position.set(
      center.x + dist * 0.7,
      center.y + dist * 0.5,
      center.z + dist * 0.7
    );
    this.controls.target.copy(center);
    this.controls.update();
  }

  clearVoxels() {
    if (this.voxelMesh) {
      this.voxelMesh.geometry.dispose();
      this.voxelMesh.material.dispose();
      this.scene.remove(this.voxelMesh);
      this.voxelMesh = null;
    }
    if (this.wireframeMesh) {
      this.wireframeMesh.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
      this.scene.remove(this.wireframeMesh);
      this.wireframeMesh = null;
    }
    this.voxelCount = 0;
  }

  setWireframe(enabled) {
    this.showWireframe = enabled;
    if (this.wireframeMesh) {
      this.wireframeMesh.visible = enabled;
    }
  }

  setAutoRotate(enabled) {
    this.autoRotate = enabled;
    this.controls.autoRotate = enabled;
  }

  takeScreenshot() {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  /**
   * Export voxels as OBJ file
   */
  exportOBJ(positions, count, resolution) {
    const voxelSize = 2.0 / resolution;
    let obj = '# Voxel model exported from Voxelizer\n';
    obj += `# ${count} voxels at resolution ${resolution}\n\n`;

    let vertexOffset = 1;
    for (let i = 0; i < count; i++) {
      const cx = positions[i * 3] * voxelSize;
      const cy = positions[i * 3 + 1] * voxelSize;
      const cz = positions[i * 3 + 2] * voxelSize;
      const h = voxelSize / 2;

      // 8 vertices of a cube
      const verts = [
        [cx-h, cy-h, cz-h], [cx+h, cy-h, cz-h],
        [cx+h, cy+h, cz-h], [cx-h, cy+h, cz-h],
        [cx-h, cy-h, cz+h], [cx+h, cy-h, cz+h],
        [cx+h, cy+h, cz+h], [cx-h, cy+h, cz+h]
      ];

      for (const v of verts) {
        obj += `v ${v[0].toFixed(6)} ${v[1].toFixed(6)} ${v[2].toFixed(6)}\n`;
      }

      const o = vertexOffset;
      // 6 faces
      obj += `f ${o} ${o+3} ${o+2} ${o+1}\n`; // front
      obj += `f ${o+4} ${o+5} ${o+6} ${o+7}\n`; // back
      obj += `f ${o} ${o+1} ${o+5} ${o+4}\n`; // bottom
      obj += `f ${o+2} ${o+3} ${o+7} ${o+6}\n`; // top
      obj += `f ${o} ${o+4} ${o+7} ${o+3}\n`; // left
      obj += `f ${o+1} ${o+2} ${o+6} ${o+5}\n`; // right

      vertexOffset += 8;
    }

    return obj;
  }

  dispose() {
    cancelAnimationFrame(this.animationId);
    this.clearVoxels();
    this._resizeObserver?.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }
}
