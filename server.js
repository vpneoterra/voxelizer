/**
 * server.js — Express CORS proxy for Tripo AI API
 * Forwards /api/tripo/* requests to api.tripo3d.ai, adding CORS headers.
 * Also serves static frontend files.
 */

const express = require('express');
const path = require('path');

const app = express();
const PORT = 8000;
const TRIPO_API = 'https://api.tripo3d.ai/v2/openapi';

// Serve static files from the project root
app.use(express.static(path.join(__dirname), {
  index: 'index.html',
  extensions: ['html', 'js', 'css']
}));

// CORS headers for all /api/ routes
app.use('/api', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

/**
 * Proxy: /api/tripo/proxy-download?url=...
 * Downloads a file from a URL and streams it back (for model GLB downloads).
 */
app.get('/api/tripo/proxy-download', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ error: 'Missing url parameter' });

  try {
    const resp = await fetch(targetUrl);
    if (!resp.ok) {
      return res.status(resp.status).json({ error: `Upstream returned ${resp.status}` });
    }
    res.set('Content-Type', resp.headers.get('content-type') || 'application/octet-stream');
    const buffer = await resp.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('proxy-download error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

/**
 * Proxy: /api/tripo/v2/openapi/upload
 * Special handling for multipart form uploads.
 */
app.post('/api/tripo/v2/openapi/upload', async (req, res) => {
  try {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);

    const headers = {
      'Content-Type': req.headers['content-type'],
    };
    if (req.headers['authorization']) {
      headers['Authorization'] = req.headers['authorization'];
    }

    const resp = await fetch(`${TRIPO_API}/upload`, {
      method: 'POST',
      headers,
      body,
    });

    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    console.error('proxy upload error:', err.message);
    res.status(502).json({ code: -1, message: err.message });
  }
});

/**
 * Proxy: /api/tripo/v2/openapi/task (POST — create task)
 */
app.post('/api/tripo/v2/openapi/task', async (req, res) => {
  try {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);

    const headers = { 'Content-Type': 'application/json' };
    if (req.headers['authorization']) {
      headers['Authorization'] = req.headers['authorization'];
    }

    const resp = await fetch(`${TRIPO_API}/task`, {
      method: 'POST',
      headers,
      body,
    });

    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    console.error('proxy task create error:', err.message);
    res.status(502).json({ code: -1, message: err.message });
  }
});

/**
 * Proxy: /api/tripo/v2/openapi/task/:taskId (GET — poll task)
 */
app.get('/api/tripo/v2/openapi/task/:taskId', async (req, res) => {
  try {
    const headers = {};
    if (req.headers['authorization']) {
      headers['Authorization'] = req.headers['authorization'];
    }

    const resp = await fetch(`${TRIPO_API}/task/${req.params.taskId}`, {
      method: 'GET',
      headers,
    });

    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    console.error('proxy task poll error:', err.message);
    res.status(502).json({ code: -1, message: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Voxelizer server running on port ${PORT}`);
  console.log(`Tripo API proxy: /api/tripo/* → ${TRIPO_API}/*`);
});
