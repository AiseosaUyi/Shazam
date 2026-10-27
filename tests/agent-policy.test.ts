import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  validateFilePath,
  validateFileChanges,
  assertNoShellExecution,
  computeUnifiedDiff,
} from '@/lib/agent/policy';

describe('Agent Security Policy Tests', () => {
  it('rejects path traversal attempts with ".." sequences', () => {
    const invalidPaths = [
      '../etc/passwd',
      'src/../../secret.txt',
      'foo/bar/../../../root',
      '..',
    ];

    for (const p of invalidPaths) {
      const res = validateFilePath(p);
      assert.strictEqual(res.valid, false, `Path "${p}" should have been rejected`);
      assert.ok(res.error?.includes('Path traversal'));
    }
  });

  it('rejects absolute paths starting with / or \\', () => {
    const res1 = validateFilePath('/var/log/app.log');
    assert.strictEqual(res1.valid, false);
    assert.ok(res1.error?.includes('Absolute paths are forbidden'));

    const res2 = validateFilePath('\\windows\\system32');
    assert.strictEqual(res2.valid, false);
  });

  it('blocks writing sensitive credential or secret files', () => {
    const sensitiveFiles = [
      '.env',
      '.env.production',
      'certs/server.pem',
      'keys/id_rsa',
      'id_ed25519',
      'config/credentials.json',
      'service-account.json',
    ];

    for (const file of sensitiveFiles) {
      const res = validateFilePath(file);
      assert.strictEqual(res.valid, false, `File "${file}" should be blocked by security policy`);
      assert.ok(res.error?.includes('blocked by security policy'));
    }
  });

  it('allows safe workspace relative file paths', () => {
    const safePaths = [
      'src/index.ts',
      'components/Button.tsx',
      'README.md',
      'docs/architecture.txt',
    ];

    for (const p of safePaths) {
      const res = validateFilePath(p);
      assert.strictEqual(res.valid, true);
    }
  });

  it('enforces maximum 256KB file size limit in proposals', () => {
    const oversizedContent = 'a'.repeat(256 * 1024 + 10);
    const res = validateFileChanges([
      {
        path: 'src/huge.txt',
        action: 'create',
        content: oversizedContent,
      },
    ]);

    assert.strictEqual(res.valid, false);
    assert.ok(res.error?.includes('exceeds the maximum allowed size of 256KB'));
  });

  it('strictly rejects shell execution with honest container requirement message', () => {
    assert.throws(
      () => {
        assertNoShellExecution();
      },
      /Running code needs an isolated container, not available in this deployment/
    );
  });

  it('computes correct unified diffs for proposal review', () => {
    const diff = computeUnifiedDiff('test.ts', 'const x = 1;', 'const x = 2;');
    assert.ok(diff.includes('--- a/test.ts'));
    assert.ok(diff.includes('+++ b/test.ts'));
    assert.ok(diff.includes('-const x = 1;'));
    assert.ok(diff.includes('+const x = 2;'));
  });
});
