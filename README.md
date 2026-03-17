# Voxelizer — Image to Voxel 3D Viewer

A vanilla JavaScript single-page application that implements an image-to-voxel pipeline. Upload a 2D image, generate a 3D mesh via the Tripo AI API, voxelize it client-side, and render an interactive voxelized 3D model in the browser using Three.js.

## Pipeline

1. **Image Input** — Upload or drag-and-drop a PNG/JPG/WebP image
2. **Mesh Generation** — Image sent to Tripo AI API → returns GLB mesh
3. **Voxelization** — Client-side surface sampling or raycasting (Web Worker)
4. **Voxel Rendering** — Three.js InstancedMesh with OrbitControls

## Features

- Tripo AI API integration (async task creation + polling)
- Local-first mode — load GLB/OBJ files directly (no API needed)
- Web Worker voxelization with progress reporting
- Configurable resolution (16 / 32 / 64 / 128)
- Surface-only and filled voxel modes
- Wireframe edge toggle
- Auto-rotate with damping
- Screenshot (PNG) and OBJ export
- Dark / Light theme
- Responsive layout (mobile stacks vertically)
- WebGL 2.0 detection with fallback

## Usage

1. Serve the project over HTTP (e.g. `npx serve .`)
2. Open in browser
3. Enter a Tripo AI API key, upload an image, and click **Generate Voxel Model**
   — or load a `.glb` / `.obj` file directly to skip the API
4. Adjust resolution, toggle modes, export as needed

## Tech Stack

- **Three.js r168** (CDN, ES module import map)
- **Vanilla JS** — no frameworks, no bundlers
- **Web Workers** for non-blocking voxelization

## File Structure

```
├── index.html          # Entry point + inline CSS
├── app.js              # Main application logic & state machine
├── tripoClient.js      # Tripo AI API wrapper
├── voxelizer.js        # Mesh-to-voxel Web Worker
└── voxelRenderer.js    # Three.js InstancedMesh rendering
```

## Browser Support

Chrome 89+ · Firefox 108+ · Safari 16.4+ · Edge 89+

## License

MIT
