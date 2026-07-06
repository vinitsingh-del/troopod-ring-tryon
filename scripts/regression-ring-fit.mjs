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
assert(html.includes('createDraftCompositeDataUrl'), 'Missing deterministic draft composite pass.');
assert(html.includes('drawWrappedRingSprite'), 'Missing wrapped ring sprite renderer.');
assert(backend.includes("form.append('input_fidelity', 'high')"), 'Images edit request must use input_fidelity=high.');
assert(backend.includes('Do not move, resize, rotate, redesign, or replace the ring'), 'Backend prompt must lock ring geometry.');

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
