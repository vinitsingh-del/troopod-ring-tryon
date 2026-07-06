import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';

const PORT = Number(process.env.PORT || 8787);
const WORKSPACE = resolve(process.cwd());
const ENV_PATH = resolve(WORKSPACE, '.env.local');
const MISTRAL_API_BASE = process.env.MISTRAL_API_BASE || 'https://api.mistral.ai/v1';
const MISTRAL_IMAGE_MODEL = process.env.MISTRAL_IMAGE_MODEL || 'mistral-medium-latest';
let mistralImageAgentId = process.env.MISTRAL_IMAGE_AGENT_ID || '';

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, '');
  }
}

loadEnvFile(ENV_PATH);

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    ...corsHeaders(),
    'Content-Type': 'application/json'
  });
  res.end(JSON.stringify(data));
}

function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    ...corsHeaders(),
    'Content-Type': contentType
  });
  res.end(text);
}

function readJson(req) {
  return new Promise((resolveBody, rejectBody) => {
    let body = '';
    let rejected = false;
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 12_000_000 && !rejected) {
        rejected = true;
        req.pause();
        rejectBody(new Error('Request is too large. Upload a smaller image or try again.'));
      }
    });
    req.on('end', () => {
      if (rejected) return;
      try {
        resolveBody(JSON.parse(body || '{}'));
      } catch {
        rejectBody(new Error('Invalid JSON request.'));
      }
    });
    req.on('error', rejectBody);
  });
}

function buildTryOnPrompt(payload) {
  const finger = payload.finger || 'ring finger';
  const handSide = payload.handSide || 'auto-detect';
  const ringName = payload.ringName || 'selected MIA ring';
  const ringDescription = payload.ringDescription || ringName;
  const handPose = handSide === 'auto-detect'
    ? 'Use a natural top-view hand pose with the back of the hand visible.'
    : `Use a natural top-view ${handSide} pose.`;
  const placementGuide = payload.placementGuide
    ? `Deterministic geometry guide from the hand parser: ${JSON.stringify(payload.placementGuide)}. Follow this placement guide closely when positioning the ring.`
    : 'No deterministic placement guide was supplied; infer the finger base visually from the uploaded hand image.';

  return [
    payload.handImage
      ? 'Generate a realistic AI jewelry try-on image based on the uploaded user hand photo. Match the uploaded hand pose, camera angle, skin tone, nail style, and background as closely as possible.'
      : 'Generate a close-up realistic AI jewelry virtual try-on photo of one human hand on a clean white or light gray surface, like an ecommerce jewelry preview.',
    `The hand must be wearing ${ringDescription} on the ${finger}.`,
    handPose,
    placementGuide,
    'The ring must sit neatly and naturally on the finger, physically worn around it, not floating and not pasted on top, with realistic scale, contact shadows, metal highlights, sparkle, and perspective.',
    'Final output must be a generated image, not text. The visible ring should be loaded onto the uploaded hand photo style and placed automatically on the chosen finger.',
    'For ring finger placement, put the ring on the finger between the middle and little finger, at the base of the proximal phalanx, below the first knuckle and just above the palm webbing.',
    'Use natural skin texture, soft shadows from the hand, neat natural nails, and a centered product-photo composition. The result should look like a real uploaded hand try-on photo.',
    'Do not add text, UI elements, labels, watermarks, sparkly logos, collage borders, or a standalone product shot.'
  ].join(' ');
}

async function callMistralImageGeneration(payload) {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    throw new Error('Mistral API key is not configured. Set MISTRAL_API_KEY in .env.local or the shell environment.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);
  try {
    const prompt = buildTryOnPrompt(payload);
    const agentId = await getMistralImageAgent(apiKey, controller.signal);
    const conversation = await startMistralImageConversation(apiKey, agentId, prompt, payload.handImage, controller.signal);
    const fileId = findMistralToolFileId(conversation);
    const imageUrl = findMistralGeneratedImageUrl(conversation);
    if (!fileId && !imageUrl) {
      throw new Error('Mistral did not return a generated image.');
    }
    const generatedImage = fileId
      ? await downloadMistralFileAsBase64(apiKey, fileId, controller.signal)
      : await downloadImageUrlAsBase64(imageUrl, controller.signal);
    return {
      image: `data:${generatedImage.contentType};base64,${generatedImage.base64}`,
      model: MISTRAL_IMAGE_MODEL,
      provider: 'mistral-image-generation'
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function mistralJson(apiKey, path, body, signal) {
  const response = await fetch(`${MISTRAL_API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
    signal
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = response.status === 429
      ? 'Mistral is rate-limited right now. Wait a moment, then try Generate Output again.'
      : data.message || data.error?.message || data.error || `Mistral API failed (${response.status}).`;
    throw new Error(message);
  }
  return data;
}

async function getMistralImageAgent(apiKey, signal) {
  if (mistralImageAgentId) return mistralImageAgentId;
  const agent = await mistralJson(apiKey, '/agents', {
    model: MISTRAL_IMAGE_MODEL,
    name: 'Jewelry Try-On Image Generator',
    description: 'Generates realistic jewelry virtual try-on images.',
    instructions: 'Use image_generation whenever the user asks for a jewelry try-on image. If the user attaches a hand image, use it as the visual reference for the hand pose, skin tone, nails, camera angle, and background. The ring must sit neatly on the selected finger and look physically worn.',
    tools: [{ type: 'image_generation' }],
    completion_args: {
      temperature: 0.3,
      top_p: 0.95
    }
  }, signal);
  mistralImageAgentId = agent.id;
  return mistralImageAgentId;
}

async function startMistralImageConversation(apiKey, agentId, prompt, handImage, signal) {
  const inputs = typeof handImage === 'string' && handImage
    ? [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: handImage }
      ]
    }]
    : prompt;
  return mistralJson(apiKey, '/conversations', {
    agent_id: agentId,
    inputs,
    store: false
  }, signal);
}

function findMistralToolFileId(value) {
  if (!value || typeof value !== 'object') return '';
  if (value.type === 'tool_file' && value.file_id) return value.file_id;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findMistralToolFileId(item);
      if (found) return found;
    }
    return '';
  }
  for (const child of Object.values(value)) {
    const found = findMistralToolFileId(child);
    if (found) return found;
  }
  return '';
}

async function downloadMistralFileAsBase64(apiKey, fileId, signal) {
  const response = await fetch(`${MISTRAL_API_BASE}/files/${encodeURIComponent(fileId)}/content`, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
    signal
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const message = data.message || data.error?.message || data.error || `Could not download Mistral image (${response.status}).`;
    throw new Error(message);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    base64: bytes.toString('base64'),
    contentType: imageContentType(bytes, response.headers.get('content-type'))
  };
}

function findMistralGeneratedImageUrl(value) {
  if (!value || typeof value !== 'object') return '';
  if (typeof value.url === 'string' && /^https?:\/\//.test(value.url)) return value.url;
  if (typeof value.result === 'string') {
    try {
      const parsed = JSON.parse(value.result);
      if (typeof parsed.url === 'string' && /^https?:\/\//.test(parsed.url)) return parsed.url;
    } catch {}
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findMistralGeneratedImageUrl(item);
      if (found) return found;
    }
    return '';
  }
  for (const child of Object.values(value)) {
    const found = findMistralGeneratedImageUrl(child);
    if (found) return found;
  }
  return '';
}

async function downloadImageUrlAsBase64(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Could not download generated image (${response.status}).`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    base64: bytes.toString('base64'),
    contentType: imageContentType(bytes, response.headers.get('content-type'))
  };
}

function imageContentType(bytes, headerType) {
  if (headerType && headerType.startsWith('image/')) return headerType;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) return 'image/png';
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) return 'image/webp';
  return 'image/jpeg';
}

export async function handleFitRing(req, res) {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }
  if (req.method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      provider: 'mistral-image-generation',
      model: MISTRAL_IMAGE_MODEL,
      hasMistralKey: Boolean(process.env.MISTRAL_API_KEY)
    });
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  try {
    const payload = await readJson(req);
    const result = await callMistralImageGeneration(payload);
    sendJson(res, 200, result);
  } catch (error) {
    const status = /api key|configured/i.test(error.message) ? 503 : 500;
    sendJson(res, status, { error: error.message || 'Image generation failed.' });
  }
}

function contentTypeFor(path) {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml'
  };
  return types[extname(path).toLowerCase()] || 'application/octet-stream';
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  const fileName = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  if (fileName.includes('..')) {
    sendText(res, 400, 'Bad request');
    return;
  }

  const filePath = resolve(WORKSPACE, fileName);
  if (!filePath.startsWith(WORKSPACE) || !existsSync(filePath)) {
    sendText(res, 404, 'Not found');
    return;
  }

  res.writeHead(200, { 'Content-Type': contentTypeFor(filePath) });
  res.end(readFileSync(filePath));
}

const isDirectRun = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isDirectRun) {
  const server = http.createServer(async (req, res) => {
    if (req.url?.startsWith('/api/fit-ring') || req.url?.startsWith('/health')) {
      await handleFitRing(req, res);
      return;
    }
    serveStatic(req, res);
  });
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`TrooPod ring try-on running at http://127.0.0.1:${PORT}`);
  });
}
