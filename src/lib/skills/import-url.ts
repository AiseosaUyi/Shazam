/** Import a skill from a GitHub URL (SSRF-safe). */

export const ALLOWED_HOSTS = ['raw.githubusercontent.com', 'gist.githubusercontent.com'] as const;

const SEG_RE = /^[A-Za-z0-9._-]+$/;

function segs(segments: string[]): void {
  for (const s of segments) {
    if (s === '..') throw new Error('Invalid GitHub link.');
    if (!SEG_RE.test(s)) throw new Error('Invalid GitHub link.');
  }
}

export function normalizeSkillUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('Enter a valid URL.');
  }

  if (url.protocol !== 'https:') {
    throw new Error('Only GitHub links (github.com, raw.githubusercontent.com, gist.githubusercontent.com) are supported.');
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('Only GitHub links (github.com, raw.githubusercontent.com, gist.githubusercontent.com) are supported.');
  }
  if (url.port !== '') {
    throw new Error('Only GitHub links (github.com, raw.githubusercontent.com, gist.githubusercontent.com) are supported.');
  }

  // URL class normalizes ../ — detect path traversal in the input string itself.
  const pathnameRaw = url.pathname;
  // Check raw input for ".." segments that were normalized away
  const inputPath = input.split('?')[0].split('#')[0];
  if (inputPath.includes('/../') || inputPath.endsWith('/..') || /\/\.\.[\\/]/.test(inputPath)) {
    throw new Error('Invalid GitHub link.');
  }

  const pathNoHash = url.pathname + url.search;
  const segsArr = pathNoHash.split('/').filter(Boolean);

  if (url.host === 'github.com') {
    // /{owner}/{repo}/blob/{ref}          (4 segments)
    // /{owner}/{repo}/blob/{ref}/{path}   (5+)
    // /{owner}/{repo}/tree/{ref}          (4)
    // /{owner}/{repo}/tree/{ref}/{dir}    (5+)
    if (segsArr.length < 4) throw new Error('Invalid GitHub link.');

    const owner = segsArr[0];
    const repo  = segsArr[1];
    const kind  = segsArr[2]!;
    const ref   = segsArr[3]!;
    const rest  = segsArr.slice(4);

    segs([owner, repo, ref, ...rest]);

    if (kind !== 'blob' && kind !== 'tree') throw new Error('Invalid GitHub link.');

    if (kind === 'blob') {
      const joined = rest.join('/');
      if (!joined.toLowerCase().endsWith('.md')) {
        throw new Error('Link to a SKILL.md (or other .md) file.');
      }
      return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${joined}`;
    } else {
      const joined = rest.join('/');
      if (joined.length === 0) {
        return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/SKILL.md`;
      }
      return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${joined}/SKILL.md`;
    }
  }

  // Allowlisted raw / gist hosts – keep URL, drop hash, validate segs & .md
  if ((ALLOWED_HOSTS as readonly string[]).includes(url.host)) {
    segs(pathNoHash.split('/').filter(Boolean));
    const result = `https://${url.host}${pathNoHash}`;
    if (!result.toLowerCase().endsWith('.md')) {
      throw new Error('Link to a SKILL.md (or other .md) file.');
    }
    return result;
  }

  throw new Error(
    'Only GitHub links (github.com, raw.githubusercontent.com, gist.githubusercontent.com) are supported.'
  );
}

export async function fetchSkillMarkdown(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const target = normalizeSkillUrl(url);
  const res = await fetchImpl(target, {
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
    headers: { Accept: 'text/plain' },
  });

  if (!res.ok) {
    throw new Error(`Couldn't download the skill (HTTP ${res.status}).`);
  }

  const contentLength = res.headers.get('content-length');
  if (contentLength !== null && parseInt(contentLength, 10) > 100_000) {
    throw new Error('Skill file is too large (max 100 KB).');
  }

  const text = await res.text();
  if (text.length > 100_000) {
    throw new Error('Skill file is too large (max 100 KB).');
  }

  return text;
}