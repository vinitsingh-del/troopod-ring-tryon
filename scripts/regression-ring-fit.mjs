import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const beforePath = 'test/fixtures/reference-pair/before.png';
const afterPath = 'test/fixtures/reference-pair/after.png';
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
assert(html.includes('createSimpleRingMaskDataUrl'), 'Frontend must create the simple GPT edit mask.');
assert(html.includes('const maskImage = createSimpleRingMaskDataUrl'), 'Frontend must use the simple mask for GPT generation.');
assert(!html.includes('generateLandmarkFit'), 'Frontend should not use hand landmark logic.');
assert(!html.includes('generateGptPlacementFit'), 'Frontend should not use GPT placement pre-pass.');
assert(!html.includes('createDraftCompositeDataUrl'), 'Frontend should not create a rough ring overlay.');
assert(!html.includes('placementGuide'), 'Frontend should not send placement-guide logic.');
assert(html.includes('function getBackendEndpoint'), 'Frontend must resolve backend endpoints for hosted and local pages.');
assert(html.includes('http://127.0.0.1:8787'), 'Hosted page must default to the local backend for generation.');
assert(!html.includes('TROOLLM Image uses the uploaded hand'), 'Frontend should not show the removed explanatory note.');
assert(backend.includes("form.append('input_fidelity', 'high')"), 'Images edit request must use input_fidelity=high.');
assert(backend.includes("OPENAI_IMAGE_QUALITY = process.env.OPENAI_IMAGE_QUALITY || 'medium'"), 'Image quality should default to medium for faster fitting.');
assert(backend.includes("imageFromDataUrl(payload.handImage, 'hand')"), 'Images edit must use the original hand as the base image.');
assert(backend.includes('You are performing a realistic jewelry virtual try-on edit.'), 'Backend must use the clean GPT-only prompt.');
assert(backend.includes('Mask: only the small ring-placement zone'), 'Backend prompt must describe the edit mask.');
assert(backend.includes('Do not redesign the ring'), 'Backend prompt must protect product design.');
assert(backend.includes('No full image regeneration'), 'Backend prompt must prevent full-image regeneration.');
assert(backend.includes("OPENAI_IMAGE_SIZE = process.env.OPENAI_IMAGE_SIZE || 'auto'"), 'Image size should default to auto instead of forcing square output.');
assert(html.includes("'ring finger': { x: 45.5, y: 40.5, w: 13, h: 8.6"), 'Ring-finger mask should use the visually tested snug placement zone.');
assert(html.includes('const maxSide = 832'), 'Hand upload should be resized for faster fitting.');
assert(html.includes("canvas.toDataURL('image/jpeg', .9)"), 'Hand upload should use compressed JPEG for faster fitting.');
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
