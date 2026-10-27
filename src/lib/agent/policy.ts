export interface FileChange {
  path: string;
  action: 'create' | 'update' | 'delete';
  content?: string;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

const MAX_FILE_SIZE = 256 * 1024; // 256 KB

const DISALLOWED_PATTERNS = [
  /^\.env(\..+)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /^id_rsa/i,
  /^id_ed25519/i,
  /credentials\.json$/i,
  /service-account.*\.json$/i,
];

const DISALLOWED_PREFIXES = ['.git/', '.ssh/', '.aws/', '..', '/'];

export function validateFilePath(filePath: string): ValidationResult {
  if (!filePath || typeof filePath !== 'string') {
    return { valid: false, error: 'File path cannot be empty.' };
  }

  const normalized = filePath.trim().replace(/\\/g, '/');

  if (normalized.startsWith('/') || normalized.startsWith('\\')) {
    return { valid: false, error: 'Absolute paths are forbidden.' };
  }

  const segments = normalized.split('/');
  for (const seg of segments) {
    if (seg === '..' || seg === '.') {
      return { valid: false, error: 'Path traversal sequences (".." or ".") are forbidden.' };
    }
  }

  for (const prefix of DISALLOWED_PREFIXES) {
    if (normalized.startsWith(prefix)) {
      return { valid: false, error: `Paths starting with "${prefix}" are forbidden.` };
    }
  }

  const filename = segments[segments.length - 1];
  for (const pattern of DISALLOWED_PATTERNS) {
    if (pattern.test(filename)) {
      return { valid: false, error: `Writing sensitive/secret file "${filename}" is blocked by security policy.` };
    }
  }

  return { valid: true };
}

export function validateFileChanges(changes: FileChange[]): ValidationResult {
  if (!Array.isArray(changes) || changes.length === 0) {
    return { valid: false, error: 'Proposals must contain at least one file change.' };
  }

  for (const change of changes) {
    if (!['create', 'update', 'delete'].includes(change.action)) {
      return { valid: false, error: `Invalid action "${change.action}". Allowed: create, update, delete.` };
    }

    const pathValidation = validateFilePath(change.path);
    if (!pathValidation.valid) {
      return pathValidation;
    }

    if (change.action !== 'delete') {
      const content = change.content ?? '';
      if (typeof content !== 'string') {
        return { valid: false, error: `File content for "${change.path}" must be a string.` };
      }
      if (new TextEncoder().encode(content).length > MAX_FILE_SIZE) {
        return { valid: false, error: `File "${change.path}" exceeds the maximum allowed size of 256KB.` };
      }
    }
  }

  return { valid: true };
}

export function assertNoShellExecution(): never {
  throw new Error('Running code needs an isolated container, not available in this deployment');
}

/**
 * Computes a simple unified diff between old and new string content
 */
export function computeUnifiedDiff(path: string, oldContent: string | null, newContent: string | null): string {
  if (oldContent === null && newContent !== null) {
    return `--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${newContent.split('\n').length} @@\n${newContent.split('\n').map(l => '+' + l).join('\n')}`;
  }
  if (oldContent !== null && newContent === null) {
    return `--- a/${path}\n+++ /dev/null\n@@ -1,${oldContent.split('\n').length} +0,0 @@\n${oldContent.split('\n').map(l => '-' + l).join('\n')}`;
  }
  if (oldContent === newContent) {
    return `--- a/${path}\n+++ b/${path}\n(No changes)`;
  }

  const oldLines = (oldContent ?? '').split('\n');
  const newLines = (newContent ?? '').split('\n');
  
  return `--- a/${path}\n+++ b/${path}\n@@ -1,${oldLines.length} +1,${newLines.length} @@\n` +
    oldLines.map(l => '-' + l).join('\n') + '\n' +
    newLines.map(l => '+' + l).join('\n');
}
