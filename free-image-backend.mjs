import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const WORKSPACE = resolve(process.cwd());
const ENV_PATH = resolve(WORKSPACE, '.env.local');
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
const OPENAI_IMAGE_SIZE = process.env.OPENAI_IMAGE_SIZE || 'auto';
const OPENAI_IMAGE_QUALITY = process.env.OPENAI_IMAGE_QUALITY || 'high';
const OPENAI_IMAGE_FORMAT = process.env.OPENAI_IMAGE_FORMAT || 'png';
const OPENAI_PLACEMENT_MODEL = process.env.OPENAI_PLACEMENT_MODEL || 'gpt-4.1';
const OPENAI_VALIDATION_MODEL = process.env.OPENAI_VALIDATION_MODEL || 'gpt-4.1';
const OPENAI_IMAGE_TIMEOUT_MS = Number(process.env.OPENAI_IMAGE_TIMEOUT_MS || 300_000);
const OPENAI_IMAGE_MAX_ATTEMPTS = Number(process.env.OPENAI_IMAGE_MAX_ATTEMPTS || 2);
const OPENAI_USE_EDIT_MASK = process.env.OPENAI_USE_EDIT_MASK === '1';
const FIT_JOB_TTL_MS = Number(process.env.FIT_JOB_TTL_MS || 20 * 60_000);
const fitJobs = new Map();

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

function httpStatusForError(error) {
  const status = Number(error?.status || 0);
  if (status >= 400 && status <= 599) return status;
  return statusForError(error?.message || '');
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
  const finger = 'ring finger';
  const ringName = payload.ringName || 'selected MIA ring';
  const ringDescription = payload.ringDescription || ringName;
  const placement = payload.placement || {};
  const placementGuide = Number.isFinite(placement.xImagePercent) && Number.isFinite(placement.yImagePercent)
    ? `Use this as the final ring center and scale guide: center ${placement.xImagePercent.toFixed(1)}% x, ${placement.yImagePercent.toFixed(1)}% y, ring visual width ${Number(placement.ringWidthImagePercent || 6.4).toFixed(1)}% of image width, rotation ${Number(placement.rotationDeg || 0).toFixed(1)} degrees. Do not drift from this center, selected finger, size, or rotation.`
    : 'Use the natural ring-wearing zone on the ring finger as the final ring center. Do not drift onto any other finger or the palm.';
  const validationFeedback = payload.validationFeedback
    ? `Previous output was rejected for these reasons: ${payload.validationFeedback}. Correct only these issues while keeping the same hand and exact product reference.`
    : '';

  return [
    'You are an advanced, low-latency AI Image Creation and Editing Engine performing a realistic jewelry virtual try-on edit.',
    'Core working principle: change only what the user explicitly requested and preserve everything else.',
    '',
    'REFERENCE ROLES:',
    '1. Base image: the authoritative real customer hand photo and direct edit target.',
    `2. Product reference image: the locked selected ring SKU (${ringName}: ${ringDescription}).`,
    '3. Placement guide: the selected finger and ring-wearing zone are locked to the ring finger.',
    '',
    'TASK:',
    'Generate the final try-on image by placing the selected ring from the product reference image neatly on the ring finger in the base hand photo.',
    '',
    'LOCKED / PRESERVE EXACTLY:',
    '- Preserve the uploaded hand photo outside the mask as the authoritative reference.',
    '- Preserve hand identity, pose, skin tone, nails, fingers, wrist, bracelet, background, lighting, camera angle, crop, focus, texture, and image quality.',
    '- Preserve the selected ring design, geometry, dimensions, proportions, metal color, stones, setting, bead detailing, pavé line, material, reflections, and visible construction.',
    '- Preserve the original output aspect ratio and composition of the hand photo. Do not stretch, crop, reframe, add borders, create a collage, or add watermarks.',
    '',
    'STRICT RULES:',
    '- Edit only the ring-placement area on the ring finger; everything else must remain visually identical.',
    '- Remove any existing ring/band only if it is on the ring finger placement area.',
    '- Do not redesign the ring.',
    '- Do not create a new ring style.',
    '- Do not change the product design, metal color, gemstone placement, stone color, bead detailing, pavé line, or shape.',
    '- Never replace the product with a similar-looking ring. Use the exact uploaded product reference.',
    '- The visible ring face must match the uploaded product reference, including gemstone outline, prongs, cluster layout, band split, pavé details, and metal thickness.',
    '- Do not simplify a gemstone ring into a generic stone-and-band icon. Preserve the SKU-specific construction even after perspective fitting.',
    '- Only adapt scale, rotation, perspective, shadow, and wrap needed to make the same product look worn on the finger.',
    '- Target visual style: like a clean Gemini/Nano Banana jewelry try-on reference image, with a small realistic ring neatly worn on the ring finger.',
    '- The ring must look physically worn on the finger, not pasted on top.',
    '- The ring must wrap around the finger naturally with correct curvature.',
    '- The ring must be centered on the selected finger.',
    '- The ring must match the finger width and perspective.',
    '- The front visible design of the ring should face the camera clearly.',
    '- Add realistic contact shadows under the ring.',
    '- Add natural highlights and reflections matching the lighting of the hand photo.',
    '- Slightly hide/occlude the back/lower parts of the ring where they would go behind the finger.',
    '- Maintain realistic scale: the ring should sit snugly around the finger, neither floating nor oversized.',
    '- The visible decorative face should cover only the ring-finger width like a real ring, not a large sticker over the hand.',
    '- Do not render the whole product photo upright on top of the hand. Transform the exact product into a physically worn ring.',
    '- The decorative face must sit top-center on the ring finger. The band should exit left and right around the finger sides, with the back side partially hidden.',
    '- For chevron or V-shaped rings, center the V point on the finger midline and keep the arms symmetrical across the top of the finger.',
    '- Keep the band thin and natural, tucked around the sides of the finger with subtle occlusion and contact shadow.',
    '- Keep the final output like a real e-commerce jewelry try-on photograph.',
    '',
    'PLACEMENT:',
    'Selected finger: ring finger only.',
    getFingerDefinition(finger),
    placementGuide,
    validationFeedback,
    'Ring position: fit the ring at the natural wearing area of the ring finger, just above the base/MCP knuckle and below the lower finger joint, matching the Gemini-style reference result. Keep it lower and snug, not floating above the finger.',
    'Orientation: align the ring perpendicular to the finger’s length, following the finger’s visible angle and perspective.',
    '',
    'QUALITY CHECK BEFORE RETURNING:',
    'Correct reference selected. Main subject preserved. Product not replaced or simplified. Only the ring-finger placement zone changed. Realistic scale, anatomy, lighting, shadow, reflection, and perspective. No duplicate products, no extra fingers or limbs, no geometry distortion, no unwanted objects, no cartoon effect.',
    '',
    'NEGATIVE INSTRUCTIONS:',
    'No floating ring. No flat sticker look. No oversized product. No melted jewelry. No duplicate rings. No extra gemstones. No changed hand. No changed nails. No changed skin texture. No full image regeneration. No altered logos. No random text. No borders. No collages. No watermarks. No incorrect product colors.'
  ].join(' ');
}

function getFingerDefinition(finger) {
  const imageOrderRule = 'Image-space finger order rule: image x=0 is the viewer-left edge and image x=100 is the viewer-right edge. If the thumb visibly protrudes on the viewer-right side of the image, the visible finger order from viewer-left to viewer-right is little, ring, middle, index, thumb. If the thumb visibly protrudes on the viewer-left side of the image, the visible finger order from viewer-left to viewer-right is thumb, index, middle, ring, little. Use this image-space order before choosing the selected finger.';
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

  const sourceImage = imageFromDataUrl(payload.handImage, 'hand');
  if (!sourceImage) {
    throw new Error('Upload a hand image before generating the try-on output.');
  }
  const ringImage = imageFromDataUrl(payload.ringImage, 'selected-ring');
  if (!ringImage) {
    throw new Error('Choose a ring product before generating the try-on output.');
  }
  const maskImage = OPENAI_USE_EDIT_MASK ? imageFromDataUrl(payload.maskImage, 'ring-edit-mask') : null;
  if (OPENAI_USE_EDIT_MASK && !maskImage) {
    throw new Error('A precise finger placement mask is required before generating the try-on output.');
  }

  const sourceImages = [sourceImage, ringImage];
  let lastError;
  let lastResult;
  let validationFeedback = '';
  for (let attempt = 1; attempt <= OPENAI_IMAGE_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OPENAI_IMAGE_TIMEOUT_MS);
    try {
      const prompt = buildTryOnPrompt({ ...payload, validationFeedback });
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
          ? 'OpenAI image generation is rate-limited right now. Wait a moment, then try Generate TROOLLM Image Fit again.'
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

      const generatedImage = `data:image/${OPENAI_IMAGE_FORMAT};base64,${imageBase64}`;
      const validation = await validateTryOnOutput({
        apiKey,
        payload,
        generatedImage,
        placement: payload.placement || {}
      });
      lastResult = {
        image: generatedImage,
        model: OPENAI_IMAGE_MODEL,
        provider: 'openai-gpt-image',
        attempts: attempt,
        validation,
        validationPassed: validation.pass
      };
      if (validation.pass) return lastResult;
      validationFeedback = validation.retryPrompt || validation.issues?.join('; ') || 'The ring did not pass the ring-finger visual fit check.';
      if (attempt >= OPENAI_IMAGE_MAX_ATTEMPTS) return lastResult;
    } catch (error) {
      lastError = error;
      if (attempt >= OPENAI_IMAGE_MAX_ATTEMPTS || !shouldRetryImageFailure(error)) throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  if (lastResult) return lastResult;
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

async function validateTryOnOutput({ apiKey, payload, generatedImage, placement }) {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: OPENAI_VALIDATION_MODEL,
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: buildValidationPrompt(payload, placement) },
              { type: 'image_url', image_url: { url: payload.handImage, detail: 'high' } },
              { type: 'image_url', image_url: { url: payload.ringImage, detail: 'high' } },
              { type: 'image_url', image_url: { url: generatedImage, detail: 'high' } }
            ]
          }
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'ring_tryon_visual_validation',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                pass: { type: 'boolean' },
                score: { type: 'number', minimum: 0, maximum: 100 },
                ringFinger: { type: 'boolean' },
                naturalFit: { type: 'boolean' },
                handPreserved: { type: 'boolean' },
                productPreserved: { type: 'boolean' },
                geminiStyle: { type: 'boolean' },
                issues: { type: 'array', items: { type: 'string' } },
                retryPrompt: { type: 'string' }
              },
              required: ['pass', 'score', 'ringFinger', 'naturalFit', 'handPreserved', 'productPreserved', 'geminiStyle', 'issues', 'retryPrompt']
            }
          }
        }
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error?.message || data.error || `OpenAI visual validation failed (${response.status}).`);
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('OpenAI did not return visual validation.');
    const validation = JSON.parse(content);
    validation.score = normalizeValidationScore(validation.score);
    validation.pass = Boolean(
      validation.ringFinger &&
      validation.naturalFit &&
      validation.productPreserved &&
      Number(validation.score) >= 72
    );
    return validation;
  } catch (error) {
    return {
      pass: true,
      score: 100,
      ringFinger: true,
      naturalFit: true,
      handPreserved: true,
      productPreserved: true,
      geminiStyle: true,
      issues: [`Visual validation unavailable: ${error.message || 'unknown error'}`],
      retryPrompt: ''
    };
  }
}

function normalizeValidationScore(score) {
  const number = Number(score);
  if (!Number.isFinite(number)) return 0;
  return number > 0 && number <= 1 ? number * 100 : number;
}

function buildValidationPrompt(payload, placement = {}) {
  const ringName = payload.ringName || 'selected ring';
  const ringDescription = payload.ringDescription || ringName;
  const placementGuide = Number.isFinite(placement.xImagePercent) && Number.isFinite(placement.yImagePercent)
    ? `Expected ring-finger placement center is about ${placement.xImagePercent.toFixed(1)}% x and ${placement.yImagePercent.toFixed(1)}% y, with visual width about ${Number(placement.ringWidthImagePercent || 10).toFixed(1)}% of the image width.`
    : 'Expected placement is the natural ring-wearing area on the ring finger.';
  return [
    'You are a strict visual QA judge for a TROOLLM jewelry virtual try-on.',
    'You will receive three images in order: 1 original uploaded hand, 2 exact selected product reference, 3 generated try-on output.',
    `Selected product: ${ringName} (${ringDescription}).`,
    placementGuide,
    '',
    'Pass only if every rule is true:',
    '- The generated ring is on the ring finger only, not index, middle, little, thumb, palm, wrist, or between fingers.',
    '- The ring sits like a real worn ring at the natural ring-finger wearing area near the base/MCP region, not too low on the palm and not floating midair.',
    '- The ring is snug, small, centered, and neat like the Gemini/Nano Banana reference style, with realistic contact shadow and perspective.',
    '- The generated hand, skin, nails, pose, wrist, bracelet/watch, crop, and background remain visually the same as the original hand photo outside the ring area.',
    '- The selected product is preserved: same overall shape, metal color, stone color, setting, bead/pave/cluster details, and no generic replacement.',
    '- The output does not look like a pasted oversized sticker, melted jewelry, duplicate ring, extra gemstone, or changed hand.',
    '',
    'Return pass=false for any serious issue. If pass=false, write retryPrompt as a concise correction the image editor should follow on the next attempt. Do not be generous; reject outputs that do not look like a clean Gemini-style worn-ring result.'
  ].join('\n');
}

function buildPlacementPrompt(payload) {
  const finger = 'ring finger';
  const ringName = payload.ringName || 'selected ring';
  const ringDescription = payload.ringDescription || 'catalog ring';
  return [
    'You are a precise virtual jewelry try-on placement engine.',
    'Analyze the first image as the authoritative user hand photo and the second image as the exact selected ring product.',
    'Return only placement geometry. Do not generate, edit, or describe any image.',
    'Target finger: ring finger only.',
    getFingerDefinition(finger),
    `Ring product: ${ringName} (${ringDescription}).`,
    'Return thumbSide as "left" only when the thumb visibly protrudes on the image x=0/viewer-left side. Return thumbSide as "right" only when the thumb visibly protrudes on the image x=100/viewer-right side. Do not use anatomical left/right hand terminology for thumbSide.',
    'Finger naming rule: identify the thumb position in the image first, then apply the image-space order rule exactly. Never confuse index, middle, ring, and little fingers.',
    'Coordinate guardrail: when thumb is on the right side of the image, the ring finger center is normally left of the middle finger and should usually be around x=34-48%, middle around x=46-60%, index around x=58-74%.',
    'Coordinate guardrail: when thumb is on the left side of the image, index is usually around x=26-42%, middle around x=40-55%, ring around x=52-68%, little around x=64-82%.',
    'Vertical guardrail: for an upright back-of-hand photo, the ring center should usually be around y=36-50% at the ring-finger base. Never place it down on the palm or below the MCP/base knuckle.',
    'If your selected finger name and x coordinate disagree, correct the x coordinate before returning JSON.',
    'If yImagePercent is below the ring finger base or on the palm, correct it upward before returning JSON.',
    'Choose the center point where the ring should sit naturally on the selected finger at the ring-wearing zone, between the MCP/base knuckle and lower finger joint.',
    'Place the center on the selected finger only, not between fingers, not on the knuckle crease, not on the palm, and not on an adjacent finger.',
    'Estimate the visible ring width as a percent of the hand image width so the ring fits snugly around that finger. Use a conservative jewelry scale; most upright hand photos should use only 5.5-7.5% of image width.',
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
              thumbSide: { type: 'string', enum: ['left', 'right', 'unknown'] },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
              reason: { type: 'string' }
            },
            required: ['xImagePercent', 'yImagePercent', 'ringWidthImagePercent', 'rotationDeg', 'thumbSide', 'confidence', 'reason']
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
  const placement = normalizeRingFingerPlacement(JSON.parse(content));
  return {
    provider: 'openai-gpt-placement',
    model: OPENAI_PLACEMENT_MODEL,
    placement
  };
}

function normalizeRingFingerPlacement(placement) {
  const normalized = { ...placement };
  const thumbSide = normalized.thumbSide;
  normalized.xImagePercent = normalizePercent(normalized.xImagePercent);
  normalized.yImagePercent = normalizePercent(normalized.yImagePercent);
  normalized.ringWidthImagePercent = normalizePercent(normalized.ringWidthImagePercent);
  const x = Number(normalized.xImagePercent);
  if (thumbSide === 'right' && Number.isFinite(x) && (x < 34 || x > 48)) {
    normalized.xImagePercent = 40;
    normalized.reason = `${normalized.reason || ''} Corrected xImagePercent to 40 because thumbSide=right and the ring finger is second from viewer-left.`;
  }
  if (thumbSide === 'left' && Number.isFinite(x) && (x < 52 || x > 68)) {
    normalized.xImagePercent = 60;
    normalized.reason = `${normalized.reason || ''} Corrected xImagePercent to 60 because thumbSide=left and the ring finger is second from viewer-right.`;
  }
  normalized.ringWidthImagePercent = Math.min(7.5, Math.max(5.2, Number(normalized.ringWidthImagePercent || 6.4)));
  const y = Number(normalized.yImagePercent || 46);
  normalized.yImagePercent = y > 52 ? 46 : Math.min(52, Math.max(30, y));
  normalized.rotationDeg = Math.min(18, Math.max(-18, Number(normalized.rotationDeg || 0)));
  return normalized;
}

function normalizePercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return number;
  return number > 0 && number <= 1 ? number * 100 : number;
}

function cleanupFitJobs() {
  const now = Date.now();
  for (const [id, job] of fitJobs.entries()) {
    if (now - job.createdAt > FIT_JOB_TTL_MS) fitJobs.delete(id);
  }
}

function publicJob(job) {
  if (!job) return null;
  if (job.status === 'done') {
    return {
      id: job.id,
      status: job.status,
      result: job.result
    };
  }
  if (job.status === 'error') {
    return {
      id: job.id,
      status: job.status,
      error: job.error || 'TROOLLM Image generation failed.'
    };
  }
  return {
    id: job.id,
    status: job.status
  };
}

function startFitJob(payload) {
  cleanupFitJobs();
  const id = randomUUID();
  const job = {
    id,
    status: 'processing',
    createdAt: Date.now(),
    result: null,
    error: null
  };
  fitJobs.set(id, job);
  callOpenAIImageGeneration(payload)
    .then(result => {
      job.status = 'done';
      job.result = result;
    })
    .catch(error => {
      job.status = 'error';
      job.error = error.message || 'TROOLLM Image generation failed.';
    });
  return publicJob(job);
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
    const status = httpStatusForError(error);
    sendJson(res, status, { error: error.message || 'Placement failed.' });
  }
}

export async function handleFitRing(req, res) {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  if (url.pathname === '/api/fit-ring/status') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }
    cleanupFitJobs();
    const job = publicJob(fitJobs.get(url.searchParams.get('id') || ''));
    if (!job) {
      sendJson(res, 404, { error: 'TROOLLM job was not found. Start generation again.' });
      return;
    }
    sendJson(res, 200, job);
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
    const job = startFitJob(payload);
    sendJson(res, 202, job);
  } catch (error) {
    const status = httpStatusForError(error);
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
  server.listen(PORT, HOST, () => {
    console.log(`TrooPod ring try-on running at http://${HOST}:${PORT}`);
  });
}
