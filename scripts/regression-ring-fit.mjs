import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const beforePath = 'test/fixtures/reference-pair/before.png';
const afterPath = 'test/fixtures/reference-pair/after.png';
const productPaths = [
  'assets/products/gleam-play-diamond.png',
  'assets/products/wave-ring.png',
  'assets/products/troquise-queen.png',
  'assets/products/emerald-cushion-ring.png',
  'assets/products/diamond-bloom-ring.png'
];
const html = readFileSync('index.html', 'utf8');
const backend = readFileSync('free-image-backend.mjs', 'utf8');

function dimensions(path) {
  const output = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', path], { encoding: 'utf8' });
  return {
    width: Number(output.match(/pixelWidth:\s*(\d+)/)?.[1]),
    height: Number(output.match(/pixelHeight:\s*(\d+)/)?.[1])
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(existsSync(beforePath), 'Missing reference before image.');
assert(existsSync(afterPath), 'Missing reference after image.');
for (const productPath of productPaths) {
  assert(existsSync(productPath), `Missing product image: ${productPath}`);
  assert(html.includes(productPath), `Frontend must reference product image: ${productPath}`);
}
assert(html.includes('Emerald Cushion Ring'), 'Frontend must include the Emerald Cushion Ring model.');
assert(html.includes('Diamond Bloom Ring'), 'Frontend must include the Diamond Bloom Ring model.');
assert(html.includes('INR 18K'), 'Frontend must include the Emerald Cushion Ring price.');
assert(html.includes('INR 32K'), 'Frontend must include the Diamond Bloom Ring price.');
assert(html.includes('Generate TROOLLM Image Fit'), 'Frontend must expose the simplified generation button.');
assert(html.includes("const TARGET_FINGER = 'ring finger'"), 'Frontend must always target the ring finger.');
assert(html.includes("const HAND_SIDE = 'auto-detect'"), 'Frontend must auto-detect hand side.');
assert(!html.includes('id="fingerSelect"'), 'Frontend should not expose a finger selector.');
assert(!html.includes('id="handSelect"'), 'Frontend should not expose a hand-side selector.');
assert(!html.includes('Place on'), 'Frontend should not show the old Place on control.');
assert(!html.includes('Hand side'), 'Frontend should not show the old Hand side control.');
assert(html.includes('getGptFingerPlacement'), 'Frontend must run GPT finger placement before generation.');
assert(html.includes("getBackendEndpoint('/api/place-ring')"), 'Frontend must call the placement endpoint.');
assert(html.includes('createPlacementRingMaskDataUrl'), 'Frontend must create a placement-based GPT edit mask.');
assert(html.includes('const maskImage = createPlacementRingMaskDataUrl'), 'Frontend must use the placement-based mask for GPT generation.');
assert(!html.includes('generateLandmarkFit'), 'Frontend should not use hand landmark logic.');
assert(!html.includes('createDraftCompositeDataUrl'), 'Frontend should not create a rough ring overlay.');
assert(html.includes('function getBackendEndpoint'), 'Frontend must resolve backend endpoints for hosted and local pages.');
assert(html.includes('http://127.0.0.1:8787'), 'Hosted page must default to the local backend for generation.');
assert(!html.includes('TROOLLM Image uses the uploaded hand'), 'Frontend should not show the removed explanatory note.');
assert(backend.includes("form.append('input_fidelity', 'high')"), 'Images edit request must use input_fidelity=high.');
assert(backend.includes("OPENAI_IMAGE_QUALITY = process.env.OPENAI_IMAGE_QUALITY || 'high'"), 'Image quality should default to high for jewelry fidelity.');
assert(backend.includes('OPENAI_IMAGE_TIMEOUT_MS'), 'Backend must allow longer high-quality image edits.');
assert(backend.includes("imageFromDataUrl(payload.handImage, 'hand')"), 'Images edit must use the original hand as the base image.');
assert(backend.includes('performing a realistic jewelry virtual try-on edit'), 'Backend must use the clean GPT-only try-on prompt.');
assert(backend.includes('advanced, low-latency AI Image Creation and Editing Engine'), 'Backend prompt must include the upgraded image-engine intelligence.');
assert(backend.includes('change only what the user explicitly requested'), 'Backend prompt must enforce the PRD preservation principle.');
assert(backend.includes('REFERENCE ROLES'), 'Backend prompt must identify authoritative reference roles.');
assert(backend.includes('LOCKED / PRESERVE EXACTLY'), 'Backend prompt must lock unrequested image elements.');
assert(backend.includes('Selected finger: ring finger only'), 'Backend prompt must force ring-finger generation.');
assert(backend.includes('Target finger: ring finger only'), 'Placement prompt must force ring-finger placement.');
assert(backend.includes('Generate the final try-on image'), 'Backend prompt must describe the simplified image-generation task.');
assert(backend.includes('Mask: only the small ring-placement zone'), 'Backend prompt must describe the edit mask.');
assert(backend.includes('Use the mask center as the final ring center'), 'Backend prompt must lock image generation to placement geometry.');
assert(backend.includes('getFingerDefinition'), 'Backend must explicitly define selected fingers for placement.');
assert(backend.includes('Image-space finger order rule'), 'Placement prompt must use image-space finger order.');
assert(backend.includes('thumb appears on the right side of the image'), 'Placement prompt must handle hands with thumb on the right.');
assert(backend.includes('Coordinate guardrail'), 'Placement prompt must constrain finger coordinates by thumb side.');
assert(backend.includes('If your selected finger name and x coordinate disagree'), 'Placement prompt must self-correct contradictory finger coordinates.');
assert(backend.includes('Never confuse index, middle, ring, and little fingers'), 'Placement prompt must protect finger selection.');
assert(backend.includes('A precise finger placement mask is required'), 'Backend must require a placement mask.');
assert(backend.includes('visible ring face must match the uploaded product reference'), 'Backend prompt must protect visible product-face fidelity.');
assert(backend.includes('Do not simplify a gemstone ring'), 'Backend prompt must prevent generic product simplification.');
assert(backend.includes('Do not redesign the ring'), 'Backend prompt must protect product design.');
assert(backend.includes('No full image regeneration'), 'Backend prompt must prevent full-image regeneration.');
assert(backend.includes('shouldRetryImageFailure'), 'Backend must retry transient image generation failures once.');
assert(backend.includes("OPENAI_IMAGE_SIZE = process.env.OPENAI_IMAGE_SIZE || 'auto'"), 'Image size should default to auto instead of forcing square output.');
assert(!html.includes('function createSimpleRingMaskDataUrl'), 'Frontend should not use the old static finger mask.');
assert(html.includes('const maxSide = 832'), 'Hand upload should be resized for faster fitting.');
assert(html.includes("canvas.toDataURL('image/jpeg', .9)"), 'Hand upload should use compressed JPEG for faster fitting.');
assert(html.includes("setProgressStage('Uploading image')"), 'Frontend must show the Uploading image progress stage.');
assert(html.includes("setProgressStage('Reading reference')"), 'Frontend must show the Reading reference progress stage.');
assert(html.includes("setProgressStage('Creating image')"), 'Frontend must show the Creating image progress stage.');
assert(html.includes("setProgressStage('Preparing preview')"), 'Frontend must show the Preparing preview progress stage.');
assert(html.includes("setProgressStage('Ready')"), 'Frontend must show the Ready progress stage.');
assert(html.includes('ringWidth * 1.65'), 'Placement mask should be wide enough for product face details.');
assert(html.includes('ringWidth * .96'), 'Placement mask should be tall enough for gemstone and prong details.');
assert(backend.includes('function statusForError'), 'Backend must classify provider error statuses.');
assert(backend.includes('return 402'), 'Backend must return 402 for billing/quota failures.');
assert(html.includes('OpenAI billing limit reached'), 'Frontend must show billing-limit failures clearly.');
assert(html.includes('Billing limit reached.'), 'Frontend toast must show billing-limit failures clearly.');
assert(html.includes('TROOLLM backend is not reachable'), 'Frontend must explain when the local backend is not running.');
assert(html.includes('Start local backend first.'), 'Frontend toast must explain backend connection failures.');
assert(backend.includes('slim worn chevron band'), 'Backend prompt should keep the ring small and neatly worn.');
assert(!backend.includes('approvedTryOnImage'), 'Backend should not return a fixed approved full-hand image.');
assert(!backend.includes('approved-visual-fit'), 'Backend should use GPT for uploaded hand photos.');

const before = dimensions(beforePath);
const after = dimensions(afterPath);
const sameSize = before.width === after.width && before.height === after.height;

if (!sameSize) {
  console.log(JSON.stringify({
    ok: true,
    referencePair: 'loaded',
    note: 'Reference images are different crops/sizes, so pixel diff outside ring bbox is skipped until same-size before/after fixtures are provided.',
    before,
    after
  }, null, 2));
} else {
  console.log(JSON.stringify({
    ok: true,
    referencePair: 'same-size',
    note: 'Implementation invariants passed; same-size fixtures are ready for strict outside-bbox pixel diff.',
    before,
    after
  }, null, 2));
}
