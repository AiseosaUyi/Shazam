const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const load = (p) => require(path.join(process.cwd(), p));
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
const taskDir = __dirname;
const os = require('os');
assert.ok(fs.existsSync('slugify.test.js'), 'slugify.test.js missing');
const good = fs.readFileSync(path.join(taskDir, 'start', 'slugify.js'), 'utf8');
const variants = {
  'correct': [good, true],
  'no-lowercase': [good.replace('.toLowerCase()', ''), false],
  'no-edge-strip': [good.replace(".replace(/^-+|-+$/g, '')", ''), false],
  'spaces-only': [good.replace('/[^a-z0-9]+/g', '/\\s+/g'), false],
  'no-trim': [good.replace('.trim()', '').replace(".replace(/^-+|-+$/g, '')", ".replace(/-+$/g, '')"), false],
};
for (const [name, [src, shouldPass]] of Object.entries(variants)) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-mut-'));
  fs.writeFileSync(path.join(d, 'slugify.js'), src);
  fs.copyFileSync('slugify.test.js', path.join(d, 'slugify.test.js'));
  const r = cp.spawnSync(process.execPath, ['--test', 'slugify.test.js'], { cwd: d, encoding: 'utf8' });
  fs.rmSync(d, { recursive: true, force: true });
  assert.equal(r.status === 0, shouldPass, 'variant "' + name + '" expected ' + (shouldPass ? 'pass' : 'fail') + '\n' + r.stdout.slice(-600));
}
