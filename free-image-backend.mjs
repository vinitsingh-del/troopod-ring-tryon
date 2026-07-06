import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';

const PORT = Number(process.env.PORT || 8787);
const WORKSPACE = resolve(process.cwd());
const ENV_PATH = resolve(WORKSPACE, '.env.local');
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
const OPENAI_IMAGE_SIZE = process.env.OPENAI_IMAGE_SIZE || 'auto';
const OPENAI_IMAGE_QUALITY = process.env.OPENAI_IMAGE_QUALITY || 'high';
const OPENAI_IMAGE_FORMAT = process.env.OPENAI_IMAGE_FORMAT || 'png';
const OPENAI_PLACEMENT_MODEL = process.env.OPENAI_PLACEMENT_MODEL || 'gpt-4.1-mini';

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

  return [
    'You are performing a realistic jewelry virtual try-on edit.',
    '',
    'INPUTS:',
    '1. Base image: a real customer hand photo.',
    `2. Product reference image: the selected ring (${ringName}: ${ringDescription}).`,
    '3. Mask: only the small ring-placement zone on the selected finger is editable.',
    '',
    'TASK:',
    'Place the selected ring from the product reference image onto the selected finger in the base hand photo.',
    '',
    'STRICT RULES:',
    '- Preserve the original hand photo exactly.',
    '- Do not change the hand shape, skin tone, nails, fingers, wrist, bracelet, background, lighting, camera angle, crop, or image quality.',
    '- Edit only inside the masked ring-placement area.',
    '- Remove any existing ring/band only if it is inside the masked area.',
    '- Do not redesign the ring.',
    '- Do not create a new ring style.',
    '- Do not change the product design, metal color, gemstone placement, stone color, bead detailing, pavé line, or shape.',
    '- The ring must look physically worn on the finger, not pasted on top.',
    '- The ring must wrap around the finger naturally with correct curvature.',
    '- The ring must be centered on the selected finger.',
    '- The ring must match the finger width and perspective.',
    '- The front visible design of the ring should face the camera clearly.',
    '- Add realistic contact shadows under the ring.',
    '- Add natural highlights and reflections matching the lighting of the hand photo.',
    '- Slightly hide/occlude the back/lower parts of the ring where they would go behind the finger.',
    '- Maintain realistic scale: the ring should sit snugly around the finger, neither floating nor oversized.',
    '- Make the ring a slim worn chevron band, not a large object. The V-shaped front should face the camera and sit snugly across the finger width.',
    '- Keep the final output like a real e-commerce jewelry try-on photograph.',
    '',
    'PLACEMENT:',
    `Selected finger: ${finger}`,
    `Hand side: ${handSide}`,
    'Ring position: place the ring at the natural ring-wearing area between the lower finger joint and the base of the finger.',
    'Orientation: align the ring perpendicular to the finger’s length, following the finger’s visible angle and perspective.',
    '',
    'QUALITY TARGET:',
    'Photorealistic, natural, clean, realistic jewelry fitting, no distortion, no extra fingers, no warped nails, no changed background, no cartoon effect.',
    '',
    'NEGATIVE INSTRUCTIONS:',
    'No floating ring. No flat sticker look. No oversized product. No melted jewelry. No duplicate rings. No extra gemstones. No changed hand. No changed nails. No changed skin texture. No full image regeneration.'
  ].join(' ');
}

function imageFromDataUrl(dataUrl, fallbackName = 'image') {
  const match = String(dataUrl || '').match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/);
  if (!match) return null;
  const mimeType = match[1] === 'image/jpg' ? 'image/jpeg' : match[1];
  const extension = mimeType.split('/')[1].replace('jpeg', 'jpg');
  return {
    blob: new Blob([Buffer.from(match[2], 'base64')], { type: mimeType }),
    filename: `${fallbackName}.${extension}`
  };
}

async function callOpenAIImageGeneration(payload) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OpenAI API key is not configured. Set OPENAI_API_KEY in .env.local or the backend host environment.');
  }

  const prompt = buildTryOnPrompt(payload);
  const sourceImage = imageFromDataUrl(payload.handImage, 'hand');
  if (!sourceImage) {
    throw new Error('Upload a hand image before generating the try-on output.');
  }
  const ringImage = imageFromDataUrl(payload.ringImage, 'selected-ring');
  if (!ringImage) {
    throw new Error('Choose a ring product before generating the try-on output.');
  }
  const maskImage = imageFromDataUrl(payload.maskImage, 'ring-edit-mask');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);
  try {
    const response = await callOpenAIImageEdit({
      apiKey,
      prompt,
      sourceImages: [sourceImage, ringImage],
      maskImage,
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = response.status === 429
        ? 'OpenAI image generation is rate-limited right now. Wait a moment, then try Fit Product again.'
        : data.error?.message || data.error || `OpenAI image generation failed (${response.status}).`;
      throw new Error(message);
    }

    const imageBase64 = data.data?.[0]?.b64_json;
    if (!imageBase64) {
      throw new Error('OpenAI did not return a generated image.');
    }

    return {
      image: `data:image/${OPENAI_IMAGE_FORMAT};base64,${imageBase64}`,
      model: OPENAI_IMAGE_MODEL,
      provider: 'openai-gpt-image'
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function callOpenAIImageEdit({ apiKey, prompt, sourceImages, maskImage, signal }) {
  const form = new FormData();
  form.append('model', OPENAI_IMAGE_MODEL);
  form.append('prompt', prompt);
  for (const sourceImage of sourceImages) {
    form.append('image[]', sourceImage.blob, sourceImage.filename);
  }
  if (maskImage) {
    form.append('mask', maskImage.blob, maskImage.filename);
  }
  form.append('n', '1');
  form.append('size', OPENAI_IMAGE_SIZE);
  form.append('quality', OPENAI_IMAGE_QUALITY);
  form.append('output_format', OPENAI_IMAGE_FORMAT);
  form.append('input_fidelity', 'high');

  return fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: form,
    signal
  });
}

function buildPlacementPrompt(payload) {
  return [
    'You are a virtual jewelry try-on placement engine.',
    'Analyze the first image as the user hand photo and the second image as the exact selected ring product.',
    'Return only placement geometry. Do not generate or edit any image.',
    `Target finger: ${payload.finger || 'ring finger'}.`,
    `Hand side hint: ${payload.handSide || 'auto-detect'}.`,
    `Ring product: ${payload.ringName || 'selected ring'} (${payload.ringDescription || 'catalog ring'}).`,
    'Choose the center point where the ring should sit naturally at the base of the selected finger.',
    'Estimate the ring width as a percent of the hand image width so the ring fits snugly around the finger.',
    'Estimate the rotation in degrees so the ring is perpendicular to the selected finger direction.',
    'The final renderer will place the original product image directly on the original hand photo, so be precise and conservative.'
  ].join('\n');
}

async function callOpenAIPlacement(payload) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OpenAI API key is not configured. Set OPENAI_API_KEY in .env.local or the backend host environment.');
  }
  if (!payload.handImage || !payload.ringImage) {
    throw new Error('Hand and ring images are required for GPT placement.');
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: OPENAI_PLACEMENT_MODEL,
      temperature: 0.1,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: buildPlacementPrompt(payload) },
            { type: 'image_url', image_url: { url: payload.handImage, detail: 'high' } },
            { type: 'image_url', image_url: { url: payload.ringImage, detail: 'low' } }
          ]
        }
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'ring_tryon_placement',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              xImagePercent: { type: 'number', minimum: 0, maximum: 100 },
              yImagePercent: { type: 'number', minimum: 0, maximum: 100 },
              ringWidthImagePercent: { type: 'number', minimum: 3, maximum: 35 },
              rotationDeg: { type: 'number', minimum: -45, maximum: 45 },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
              reason: { type: 'string' }
            },
            required: ['xImagePercent', 'yImagePercent', 'ringWidthImagePercent', 'rotationDeg', 'confidence', 'reason']
          }
        }
      }
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error?.message || data.error || `OpenAI placement failed (${response.status}).`);
  }
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI did not return placement geometry.');
  const placement = JSON.parse(content);
  return {
    provider: 'openai-gpt-placement',
    model: OPENAI_PLACEMENT_MODEL,
    placement
  };
}

async function handlePlaceRing(req, res) {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }
  if (req.method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      provider: 'openai-gpt-placement',
      model: OPENAI_PLACEMENT_MODEL,
      hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY)
    });
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  try {
    const payload = await readJson(req);
    const result = await callOpenAIPlacement(payload);
    sendJson(res, 200, result);
  } catch (error) {
    const status = /api key|configured/i.test(error.message) ? 503 : 500;
    sendJson(res, status, { error: error.message || 'Placement failed.' });
  }
}

export async function handleFitRing(req, res) {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }
  if (req.method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      provider: 'openai-gpt-image',
      model: OPENAI_IMAGE_MODEL,
      hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY)
    });
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  try {
    const payload = await readJson(req);
    const result = await callOpenAIImageGeneration(payload);
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
    if (req.url?.startsWith('/api/place-ring')) {
      await handlePlaceRing(req, res);
      return;
    }
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
