import { describe, it } from 'node:test';
import assert from 'node:assert';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { commandTrustKey } = require('../desktop/bridge-core.js') as { commandTrustKey: (c: string) => string | null };

describe('desktop "always allow here" only covers plain, safe commands', () => {
  it('remembers a plain git push and vercel deploy', () => {
    assert.strictEqual(commandTrustKey('git push'), 'git push');
    assert.strictEqual(commandTrustKey('git push -u origin feature/x'), 'git push');
    assert.strictEqual(commandTrustKey('vercel --prod'), 'vercel deploy');
  });
  it('never remembers forced, chained, injected or destructive commands', () => {
    for (const c of ['git push --force', 'git push -f', 'git push origin +main', 'git push origin :old', 'git push --delete origin x',
      'git push && rm -rf /', 'git push; sudo x', 'git push origin $(whoami)', 'git push `id`', 'rm -rf node_modules', 'sudo ls', 'npm publish', 'git reset --hard']) {
      assert.strictEqual(commandTrustKey(c), null, c);
    }
  });
});
