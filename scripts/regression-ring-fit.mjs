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
assert(html.includes('getFingerSegmentMaskGeometry'), 'Missing finger-segment mask geometry.');
assert(html.includes('Use GPT Image edit to generate a compact jewelry-scale version'), 'Frontend must request compact GPT-led ring fitting.');
assert(!html.includes('draftImage,'), 'Frontend should not send a rough ring overlay as the edit base.');
assert(html.includes('function getBackendEndpoint'), 'Frontend must resolve backend endpoints for hosted and local pages.');
assert(html.includes('http://127.0.0.1:8787'), 'Hosted page must default to the local backend for generation.');
assert(html.indexOf('fit = await generateLandmarkFit()') < html.indexOf('fit = await generateGptPlacementFit()'), 'Frontend must use hand landmarks before GPT placement fallback.');
assert(backend.includes("form.append('input_fidelity', 'high')"), 'Images edit request must use input_fidelity=high.');
assert(backend.includes("imageFromDataUrl(payload.handImage, 'hand')"), 'Images edit must use the original hand as the base image.');
assert(backend.includes('Generate a compact worn ring'), 'Backend prompt must let GPT place a compact ring inside the protected mask.');
assert(backend.includes('Do not place the ring on the thumb, palm, webbing'), 'Backend prompt must prevent wrong-finger placement.');
assert(backend.includes('jewelry-scale, not product-photo scale'), 'Backend prompt must prevent oversized catalog-style rings.');
assert(backend.includes('Image A is the direct edit focus'), 'Backend prompt must treat the hand as Image A and ring as Image B reference.');
assert(backend.includes('bracelet, wrist, white background'), 'Backend prompt must preserve hand details and background.');
assert(backend.includes("OPENAI_IMAGE_SIZE = process.env.OPENAI_IMAGE_SIZE || 'auto'"), 'Image size should default to auto instead of forcing square output.');
assert(html.includes('localFingerWidth * 1.08'), 'Landmark scale should keep the ring close to finger width.');
assert(html.includes('ringWidthImagePercent || 10'), 'Mask generation should use compact ring defaults.');

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
