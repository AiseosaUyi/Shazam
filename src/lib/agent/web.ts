/**
 * Server-side web access for the code agent: a guarded fetch and a keyless-first web search.
 * Everything here is honest about failure (PRD R0.1): a failed search says so, it never invents results.
 */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export const SEARCH_MAX_RESULTS = 8;
const SEARCH_TIMEOUT_MS = 8000;
const SEARCH_MAX_CHARS = 6000;
const MAX_REDIRECTS = 3;
export const SEARCH_UNAVAILABLE = 'Error: web search unavailable right now (no search backend responded). Do not invent results; say you could not search, or use web_fetch on a URL you already know.';

type FetchLike = typeof fetch;

/** Returns an error string when the URL must not be fetched (non-http(s), private, loopback, link-local, internal), else null. */
export function urlBlockReason(raw: string, opts: { httpsOnly?: boolean } = {}): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return 'Error: invalid URL.';
  }
  const deny = 'Error: only public https URLs are allowed.';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && !opts.httpsOnly)) return deny;
  if (u.username || u.password) return 'Error: URLs with credentials are not allowed.';
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host.includes(':') || host.startsWith('[')) return deny; // IPv6 literals
  if (host === 'localhost' || /\.(localhost|local|internal|lan|home|corp|intranet)$/.test(host)) return deny;
  const quad = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (quad) {
    const [a, b] = [Number(quad[1]), Number(quad[2])];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return deny;
    if (a === 169 && b === 254) return deny;
    if (a === 172 && b >= 16 && b <= 31) return deny;
    if (a === 192 && b === 168) return deny;
    if (a === 100 && b >= 64 && b <= 127) return deny; // carrier-grade NAT
    return null;
  }
  if (!host.includes('.') || /^[\d.x]+$/i.test(host)) return deny; // single-label or odd numeric hosts
  return null;
}

/** fetch that re-checks every redirect hop against the SSRF guard. */
async function guardedFetch(url: string, init: RequestInit, fetchImpl: FetchLike, httpsOnly: boolean): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const blocked = urlBlockReason(current, { httpsOnly });
    if (blocked) throw new Error(blocked.replace(/^Error: /, ''));
    const res = await fetchImpl(current, { ...init, redirect: 'manual' });
    const loc = res.status >= 300 && res.status < 400 ? res.headers?.get?.('location') : null;
    if (!loc) return res;
    current = new URL(loc, current).toString();
  }
  throw new Error('too many redirects');
}

export function htmlToText(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function webFetchText(url: string, opts: { fetchImpl?: FetchLike; signal?: AbortSignal } = {}): Promise<string> {
  const blocked = urlBlockReason(url, { httpsOnly: true });
  if (blocked) return blocked;
  try {
    const signal = opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000);
    const res = await guardedFetch(url, { signal, headers: { 'User-Agent': 'ArcworkAgent/1.0' } }, opts.fetchImpl ?? fetch, true);
    return `HTTP ${res.status}\n${htmlToText(await res.text()).slice(0, 12000)}`;
  } catch (err) {
    return `Error: could not fetch ${url}: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, ' ');
}

const clean = (s: string) => decodeEntities(htmlToText(s));

/** Defensive parse of DuckDuckGo's HTML endpoint; returns [] if the markup is not what we expect. */
export function parseDuckDuckGo(html: string): SearchResult[] {
  const out: SearchResult[] = [];
  const anchors = html.matchAll(/<a\b[^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/gi);
  for (const m of anchors) {
    const tag = m[0];
    const href = tag.match(/href="([^"]+)"/i)?.[1];
    if (!href) continue;
    let url = decodeEntities(href);
    if (url.startsWith('//')) url = `https:${url}`;
    try {
      const target = new URL(url).searchParams.get('uddg');
      if (target) url = target;
    } catch {
      continue;
    }
    // Snippet: the first result__snippet after this anchor and before the next result anchor.
    const after = html.slice((m.index ?? 0) + tag.length);
    const nextAnchor = after.search(/class="[^"]*result__a[^"]*"/i);
    const region = nextAnchor === -1 ? after : after.slice(0, nextAnchor);
    const snip = region.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/i)?.[1] ?? '';
    const title = clean(m[1]);
    if (title) out.push({ title, url, snippet: clean(snip) });
  }
  return out;
}

async function searchBrave(query: string, key: string, f: FetchLike, signal: AbortSignal): Promise<SearchResult[]> {
  const res = await f(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${SEARCH_MAX_RESULTS}`, { signal, headers: { Accept: 'application/json', 'X-Subscription-Token': key } });
  if (!res.ok) throw new Error(`Brave HTTP ${res.status}`);
  const data = (await res.json()) as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } };
  return (data.web?.results ?? []).map((r) => ({ title: clean(r.title ?? ''), url: r.url ?? '', snippet: clean(r.description ?? '') }));
}

async function searchTavily(query: string, key: string, f: FetchLike, signal: AbortSignal): Promise<SearchResult[]> {
  const res = await f('https://api.tavily.com/search', { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ query, max_results: SEARCH_MAX_RESULTS }) });
  if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
  const data = (await res.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
  return (data.results ?? []).map((r) => ({ title: clean(r.title ?? ''), url: r.url ?? '', snippet: clean(r.content ?? '') }));
}

async function searchDuckDuckGo(query: string, f: FetchLike, signal: AbortSignal): Promise<SearchResult[]> {
  const res = await f(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ArcworkAgent/1.0)', Accept: 'text/html' } });
  if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status}`);
  return parseDuckDuckGo(await res.text());
}

/** Formats results as text for the model, capped in size. Public URLs only; never fabricates. */
export function formatResults(results: SearchResult[]): string {
  const safe = results.filter((r) => r.url && !urlBlockReason(r.url)).slice(0, SEARCH_MAX_RESULTS);
  if (!safe.length) return '';
  return safe.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet.slice(0, 300)}`).join('\n').slice(0, SEARCH_MAX_CHARS);
}

/** Backend chain: Brave (BRAVE_SEARCH_API_KEY) → Tavily (TAVILY_API_KEY) → DuckDuckGo HTML (keyless) → honest "unavailable". */
export async function webSearch(query: string, opts: { fetchImpl?: FetchLike; signal?: AbortSignal; env?: Record<string, string | undefined> } = {}): Promise<string> {
  const q = query.trim();
  if (!q) return 'Error: empty search query.';
  const f = opts.fetchImpl ?? fetch;
  const env = opts.env ?? process.env;
  const mk = () => (opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(SEARCH_TIMEOUT_MS)]) : AbortSignal.timeout(SEARCH_TIMEOUT_MS));
  const backends: Array<() => Promise<SearchResult[]>> = [];
  if (env.BRAVE_SEARCH_API_KEY) backends.push(() => searchBrave(q, env.BRAVE_SEARCH_API_KEY!, f, mk()));
  if (env.TAVILY_API_KEY) backends.push(() => searchTavily(q, env.TAVILY_API_KEY!, f, mk()));
  backends.push(() => searchDuckDuckGo(q, f, mk()));
  for (const run of backends) {
    if (opts.signal?.aborted) break;
    try {
      const text = formatResults(await run());
      if (text) return `Search results for "${q}":\n${text}`;
    } catch {
      // try the next backend
    }
  }
  return SEARCH_UNAVAILABLE;
}
