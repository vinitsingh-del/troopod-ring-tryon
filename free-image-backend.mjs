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

function statusForError(message = '') {
  if (/billing|hard limit|quota|credits|insufficient/i.test(message)) return 402;
  if (/api key|configured/i.test(message)) return 503;
  return 500;
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
  const placement = payload.placement || {};
  const placementGuide = Number.isFinite(placement.xImagePercent) && Number.isFinite(placement.yImagePercent)
    ? `Use the mask center as the final ring center. Placement geometry from the analysis pass: center ${placement.xImagePercent.toFixed(1)}% x, ${placement.yImagePercent.toFixed(1)}% y, ring visual width ${Number(placement.ringWidthImagePercent || 10).toFixed(1)}% of image width, rotation ${Number(placement.rotationDeg || 0).toFixed(1)} degrees. Do not drift from this center, selected finger, size, or rotation.`
    : 'Use the transparent mask center as the final ring center. Do not drift away from the masked ring-wearing zone.';

  return [
    'You are an advanced, low-latency AI Image Creation and Editing Engine performing a realistic jewelry virtual try-on edit.',
    'Core working principle: change only what the user explicitly requested and preserve everything else.',
    '',
    'REFERENCE ROLES:',
    '1. Base image: the authoritative real customer hand photo and direct edit target.',
    `2. Product reference image: the locked selected ring SKU (${ringName}: ${ringDescription}).`,
    '3. Mask: only the small ring-placement zone on the selected finger is editable.',
    '',
    'TASK:',
    'Place the selected ring from the product reference image onto the selected finger in the base hand photo.',
    '',
    'LOCKED / PRESERVE EXACTLY:',
    '- Preserve the uploaded hand photo outside the mask as the authoritative reference.',
    '- Preserve hand identity, pose, skin tone, nails, fingers, wrist, bracelet, background, lighting, camera angle, crop, focus, texture, and image quality.',
    '- Preserve the selected ring design, geometry, dimensions, proportions, metal color, stones, setting, bead detailing, pavé line, material, reflections, and visible construction.',
    '- Preserve the original output aspect ratio and composition of the hand photo. Do not stretch, crop, reframe, add borders, create a collage, or add watermarks.',
    '',
    'STRICT RULES:',
    '- Edit only inside the masked ring-placement area.',
    '- Remove any existing ring/band only if it is inside the masked area.',
    '- Do not redesign the ring.',
    '- Do not create a new ring style.',
    '- Do not change the product design, metal color, gemstone placement, stone color, bead detailing, pavé line, or shape.',
    '- Never replace the product with a similar-looking ring. Use the exact uploaded product reference.',
    '- The visible ring face must match the uploaded product reference, including gemstone outline, prongs, cluster layout, band split, pavé details, and metal thickness.',
    '- Do not simplify a gemstone ring into a generic stone-and-band icon. Preserve the SKU-specific construction even after perspective fitting.',
    '- Only adapt scale, rotation, perspective, shadow, and wrap needed to make the same product look worn on the finger.',
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
    getFingerDefinition(finger),
    placementGuide,
    'Ring position: place the ring at the natural ring-wearing area between the lower finger joint and the base of the finger.',
    'Orientation: align the ring perpendicular to the finger’s length, following the finger’s visible angle and perspective.',
    '',
    'QUALITY CHECK BEFORE RETURNING:',
    'Correct reference selected. Main subject preserved. Product not replaced or simplified. Only masked ring-placement zone changed. Realistic scale, anatomy, lighting, shadow, reflection, and perspective. No duplicate products, no extra fingers or limbs, no geometry distortion, no unwanted objects, no cartoon effect.',
    '',
    'NEGATIVE INSTRUCTIONS:',
    'No floating ring. No flat sticker look. No oversized product. No melted jewelry. No duplicate rings. No extra gemstones. No changed hand. No changed nails. No changed skin texture. No full image regeneration. No altered logos. No random text. No borders. No collages. No watermarks. No incorrect product colors.'
  ].join(' ');
}

function getFingerDefinition(finger) {
  const imageOrderRule = 'Image-space finger order rule: if the thumb appears on the right side of the image, the visible finger order from left to right is little, ring, middle, index, thumb. If the thumb appears on the left side of the image, the visible finger order from left to right is thumb, index, middle, ring, little. Use this image-space order before choosing the selected finger.';
  const definitions = {
    thumb: 'Finger definition: thumb is the short outer finger at the side of the hand.',
    'index finger': 'Finger definition: index finger is directly next to the thumb, also called the pointer finger.',
    'middle finger': 'Finger definition: middle finger is the longest central finger.',
    'ring finger': 'Finger definition: ring finger is the fourth finger from the thumb and the second finger from the little finger.',
    'little finger': 'Finger definition: little finger is the smallest outer finger opposite the thumb.'
  };
  return `${imageOrderRule} ${definitions[finger] || definitions['ring finger']}`;
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
  if (!maskImage) {
    throw new Error('A precise finger placement mask is required before generating the try-on output.');
  }

  const sourceImages = [sourceImage, ringImage];
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180_000);
    try {
      const response = await callOpenAIImageEdit({
        apiKey,
        prompt,
        sourceImages,
        maskImage,
        signal: controller.signal
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = response.status === 429
          ? 'OpenAI image generation is rate-limited right now. Wait a moment, then try Fit Product again.'
          : data.error?.message || data.error || `OpenAI image generation failed (${response.status}).`;
        const error = new Error(message);
        error.status = response.status;
        throw error;
      }

      const imageBase64 = data.data?.[0]?.b64_json;
      if (!imageBase64) {
        const error = new Error('OpenAI did not return a generated image.');
        error.status = response.status;
        throw error;
      }

      return {
        image: `data:image/${OPENAI_IMAGE_FORMAT};base64,${imageBase64}`,
        model: OPENAI_IMAGE_MODEL,
        provider: 'openai-gpt-image',
        attempts: attempt
      };
    } catch (error) {
      lastError = error;
      if (attempt >= 2 || !shouldRetryImageFailure(error)) throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error('OpenAI image generation failed.');
}

function shouldRetryImageFailure(error) {
  const message = error?.message || '';
  if (/billing|hard limit|quota|credits|insufficient|api key|configured|invalid|content policy/i.test(message)) return false;
  if (error?.name === 'AbortError') return false;
  const status = Number(error?.status || 0);
  return !status || status === 408 || status === 409 || status === 429 || status >= 500;
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
  const finger = payload.finger || 'ring finger';
  const ringName = payload.ringName || 'selected ring';
  const ringDescription = payload.ringDescription || 'catalog ring';
  return [
    'You are a precise virtual jewelry try-on placement engine.',
    'Analyze the first image as the authoritative user hand photo and the second image as the exact selected ring product.',
    'Return only placement geometry. Do not generate, edit, or describe any image.',
    `Target finger: ${finger}.`,
    getFingerDefinition(finger),
    `Hand side hint: ${payload.handSide || 'auto-detect'}.`,
    `Ring product: ${ringName} (${ringDescription}).`,
    'Finger naming rule: identify the thumb position in the image first, then apply the image-space order rule exactly. Never confuse index, middle, ring, and little fingers.',
    'Coordinate guardrail: when thumb is on the right side of the image, the ring finger center is normally left of the middle finger and should usually be around x=34-48%, middle around x=46-60%, index around x=58-74%.',
    'Coordinate guardrail: when thumb is on the left side of the image, index is usually around x=26-42%, middle around x=40-55%, ring around x=52-68%, little around x=64-82%.',
    'If your selected finger name and x coordinate disagree, correct the x coordinate before returning JSON.',
    'Choose the center point where the ring should sit naturally on the selected finger at the ring-wearing zone, between the MCP/base knuckle and lower finger joint.',
    'Place the center on the selected finger only, not between fingers, not on the knuckle crease, not on the palm, and not on an adjacent finger.',
    'Estimate the visible ring width as a percent of the hand image width so the ring fits snugly around that finger. Use a conservative jewelry scale.',
    'Estimate the rotation in degrees so the ring is perpendicular to the selected finger direction.',
    'The next step will create a tight transparent edit mask from your geometry, so be precise and conservative.',
    'If the requested finger is visible, confidence must reflect how certain the selected finger and exact ring-wearing zone are.'
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
    const status = statusForError(error.message);
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
    const status = statusForError(error.message);
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
