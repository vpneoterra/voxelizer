/**
 * tripoClient.js — Tripo AI API wrapper
 * Handles image upload, task creation, polling, and GLB download.
 */

const API_BASE = 'https://api.tripo3d.ai/v2/openapi';

export class TripoClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.abortController = null;
  }

  /**
   * Cancel any in-flight request
   */
  cancel() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Upload image and get a file token
   */
  async uploadImage(file, onProgress) {
    this.abortController = new AbortController();
    onProgress?.('upload', 'active');

    const formData = new FormData();
    formData.append('file', file);

    const resp = await fetch(`${API_BASE}/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: formData,
      signal: this.abortController.signal
    });

    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}));
      throw new Error(errBody.message || `Upload failed (HTTP ${resp.status})`);
    }

    const data = await resp.json();
    if (data.code !== 0) {
      throw new Error(data.message || 'Upload failed');
    }

    onProgress?.('upload', 'done');
    return data.data.image_token;
  }

  /**
   * Create an image-to-model task
   */
  async createTask(imageToken, onProgress) {
    onProgress?.('generate', 'active');

    const resp = await fetch(`${API_BASE}/task`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'image_to_model',
        file: { type: 'image', file_token: imageToken }
      }),
      signal: this.abortController.signal
    });

    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}));
      throw new Error(errBody.message || `Task creation failed (HTTP ${resp.status})`);
    }

    const data = await resp.json();
    if (data.code !== 0) {
      throw new Error(data.message || 'Task creation failed');
    }

    return data.data.task_id;
  }

  /**
   * Poll task until success or failure, with exponential backoff on 429
   */
  async pollTask(taskId, onProgress, timeoutMs = 120000) {
    const start = Date.now();
    let delay = 3000;
    let retries429 = 0;
    const MAX_429_RETRIES = 3;

    while (Date.now() - start < timeoutMs) {
      // Check abort
      if (this.abortController?.signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const resp = await fetch(`${API_BASE}/task/${taskId}`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        signal: this.abortController.signal
      });

      if (resp.status === 429) {
        retries429++;
        if (retries429 > MAX_429_RETRIES) {
          throw new Error('API rate limit exceeded. Please try again later.');
        }
        delay = Math.min(delay * 2, 15000);
        await this._sleep(delay);
        continue;
      }

      if (!resp.ok) {
        throw new Error(`Poll failed (HTTP ${resp.status})`);
      }

      const data = await resp.json();
      const status = data.data?.status;
      const progress = data.data?.progress;

      onProgress?.('generate', 'active', { progress, elapsed: Date.now() - start });

      if (status === 'success') {
        onProgress?.('generate', 'done');
        return data.data.output?.model;
      }

      if (status === 'failed' || status === 'cancelled') {
        throw new Error(`Generation ${status}: ${data.data?.message || 'Unknown error'}`);
      }

      // Still running — wait and poll again
      await this._sleep(delay);
    }

    throw new Error('Generation timed out after 120 seconds.');
  }

  /**
   * Download the GLB file as ArrayBuffer
   */
  async downloadModel(modelUrl, onProgress) {
    onProgress?.('download', 'active');

    const resp = await fetch(modelUrl, {
      signal: this.abortController.signal
    });

    if (!resp.ok) {
      throw new Error(`Model download failed (HTTP ${resp.status})`);
    }

    const buffer = await resp.arrayBuffer();
    onProgress?.('download', 'done');
    return buffer;
  }

  /**
   * Full pipeline: image → task → poll → download GLB
   */
  async generateFromImage(file, onProgress) {
    const imageToken = await this.uploadImage(file, onProgress);
    const taskId = await this.createTask(imageToken, onProgress);
    const modelUrl = await this.pollTask(taskId, onProgress);

    if (!modelUrl) {
      throw new Error('No model URL in API response');
    }

    const glbBuffer = await this.downloadModel(modelUrl, onProgress);
    return glbBuffer;
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
