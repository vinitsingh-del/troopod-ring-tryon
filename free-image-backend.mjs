import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';

const PORT = Number(process.env.PORT || 8787);
const WORKSPACE = resolve(process.cwd());
const ENV_PATH = resolve(WORKSPACE, '.env.local');
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
const OPENAI_IMAGE_SIZE = process.env.OPENAI_IMAGE_SIZE || 'auto';
const OPENAI_IMAGE_QUALITY = process.env.OPENAI_IMAGE_QUALITY || 'medium';
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
  const handPose = handSide === 'auto-detect'
    ? 'Use the uploaded hand pose and camera angle.'
    : `Use the uploaded ${handSide} pose and camera angle.`;
  const placementGuide = payload.placementGuide
    ? `Finger placement guide from the hand parser: ${JSON.stringify(payload.placementGuide)}. Use this only to identify the correct finger base and approximate scale. You may adjust the ring within the transparent mask so it sits naturally.`
    : 'Infer the selected finger base visually from the uploaded hand image.';
  const targetFingerRule = describeTargetFinger(finger);

  return [
    'Image A is the direct edit focus: the uploaded hand photo. Image B is reference only: the selected catalog ring design.',
    'Edit Image A only within the transparent mask area. Preserve Image A outside the mask.',
    'Preserve the hand, skin tone, skin texture, nail shape, bracelet, wrist, white background, lighting, camera angle, and hand pose from Image A exactly. Do not regenerate or beautify the hand.',
    'Use Image B as the exact visual reference for the ring design. Do not imagine a generic ring.',
    `Add this exact ring design (${ringDescription}) onto the ${finger}, matching the reference ring's real proportions, band width, stone or setting type, metal color, stone placement, and style.`,
    targetFingerRule,
    'Generate a compact worn ring inside the transparent finger-base edit area. It should wrap around the finger and sit just above the knuckle bulge at the base of the selected finger.',
    handPose,
    placementGuide,
    'Choose the exact final size, rotation, and occlusion needed for the ring to be physically worn on the finger. Match finger curvature, perspective, and camera angle.',
    'The ring must be jewelry-scale, not product-photo scale. Keep the visible ring compact: do not let decorative points, V shapes, stones, or band edges extend far down the finger or onto the palm.',
    'The ring should span roughly the finger width at the placement point with only a small margin on each side.',
    'Blend this ring naturally onto the finger. Add a soft contact shadow directly beneath the band where it meets the skin, add a subtle specular highlight on the top curve of the band matching the photo light direction, and slightly darken the underside of the band.',
    'The ring must sit neatly and naturally on the finger, physically worn around it, not floating and not pasted on top.',
    'Keep the selected ring design faithful to the product reference: preserve the recognizable silhouette, metal color, stones, setting, and style.',
    'Return one final photorealistic try-on photo only, keeping the original Image A aspect ratio and composition. Prefer the original 4:3 framing when the uploaded hand photo is 4:3.',
    'Do not add text, UI elements, labels, watermarks, logos, collage borders, or a standalone product shot.'
  ].join(' ');
}

function describeTargetFinger(finger) {
  const rules = {
    'ring finger': 'Target only the ring finger: the fourth finger, between the middle finger and little finger. Do not place the ring on the thumb, palm, webbing, index finger, or wrist.',
    'index finger': 'Target only the index finger: the finger next to the thumb. Do not place the ring on the thumb, palm, webbing, middle finger, or wrist.',
    'middle finger': 'Target only the middle finger: the central longest finger. Do not place the ring on the thumb, palm, webbing, index finger, ring finger, or wrist.',
    'little finger': 'Target only the little finger: the smallest outer finger. Do not place the ring on the thumb, palm, webbing, ring finger, or wrist.',
    thumb: 'Target only the thumb. Do not place the ring on the palm, webbing, wrist, or other fingers.'
  };
  return rules[finger] || rules['ring finger'];
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
