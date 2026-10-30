/**
 * Picks the right Shazam agent for a request *before* anything runs, and says what is
 * missing to do it well. Deterministic and instant (no model call), so it is free and can
 * run on every keystroke-debounce in the UI and for every MCP request.
 */

export type AgentKind = 'code' | 'cowork' | 'image' | 'video' | 'chat';

export interface SuggestContext {
  googleConnected: boolean;
  githubConnected: boolean;
  desktopOnline: boolean;
  browserOnline: boolean;
  sandbox: boolean;
  mcpServers: string[];
  hasOwnKey: boolean;
}

export interface Suggestion {
  agent: AgentKind;
  confidence: number;
  reason: string;
  model: string;
  tools: string[];
  missing: Array<{ what: string; fix: string }>;
  tips: string[];
}

const RULES: Array<{ agent: AgentKind; rx: RegExp; weight: number; tool?: string }> = [
  // Code
  { agent: 'code', rx: /\b(code|bug|fix|refactor|function|component|api|endpoint|typescript|javascript|python|react|next\.?js|test(s)?|unit test|build|compile|deploy|repo|repository|pull request|\bpr\b|commit|push|git|npm|package\.json|css|html|database|schema|migration|lint|stack trace|error:|exception|script|cli)\b/i, weight: 2 },
  { agent: 'code', rx: /\b(app|website|landing page|dashboard|saas|backend|frontend)\b/i, weight: 1 },
  { agent: 'code', rx: /```|\.(ts|tsx|js|py|go|rs|java|rb|php|sql)\b/i, weight: 3 },
  // Co-Work
  { agent: 'cowork', rx: /\b(email|e-mail|gmail|inbox|reply|draft|send (a|an|the)? ?(mail|message)|newsletter)\b/i, weight: 3, tool: 'gmail' },
  { agent: 'cowork', rx: /\b(schedule|every (day|week|monday|tuesday|wednesday|thursday|friday|morning)|remind|tomorrow at|at \d{1,2}(:\d{2})?\s?(am|pm)|recurring|weekly|daily)\b/i, weight: 2, tool: 'schedule' },
  { agent: 'cowork', rx: /\b(calendar|meeting|invite|event|availability|book a call)\b/i, weight: 3, tool: 'calendar' },
  { agent: 'cowork', rx: /\b(research|summari[sz]e|notion|linear|slack|crm|lead(s)?|report|spreadsheet|browse|website audit|look up|find out|competitor)\b/i, weight: 1.5 },
  { agent: 'cowork', rx: /\b(open|go to|log ?in to|click|fill (in|out)|on (my )?(browser|chrome)|instagram|linkedin|twitter|x\.com)\b/i, weight: 1.5, tool: 'browser' },
  // Image
  { agent: 'image', rx: /\b(image|picture|photo|poster|logo|illustration|thumbnail|banner|render|draw|paint|visual|mockup|flyer|graphic)\b/i, weight: 2.5 },
  { agent: 'image', rx: /^(draw|paint|generate an? (image|picture|photo)|create an? (image|poster|logo))/i, weight: 4 },
  { agent: 'image', rx: /\b(make|create|design|generate)\b[^.]{0,40}\b(poster|logo|flyer|banner|image|illustration|thumbnail|cover)\b/i, weight: 3 },
  // Video
  { agent: 'video', rx: /\b(video|clip|reel|tiktok|shorts|footage|caption(s)?|subtitle(s)?|trim|cut the|silence(s)?|reframe|edit (this|my) (video|clip))\b/i, weight: 3 },
  { agent: 'video', rx: /\.(mp4|mov|webm|mkv)\b/i, weight: 4 },
];

export function suggestAgent(prompt: string, ctx: SuggestContext): Suggestion {
  const text = prompt.trim();
  const scores: Record<AgentKind, number> = { code: 0, cowork: 0, image: 0, video: 0, chat: 0.8 };
  const tools = new Set<string>();
  for (const r of RULES) {
    const hits = text.match(new RegExp(r.rx.source, r.rx.flags.includes('g') ? r.rx.flags : `${r.rx.flags}g`));
    if (hits) {
      scores[r.agent] += r.weight * Math.min(3, hits.length);
      if (r.tool) tools.add(r.tool);
    }
  }
  // A short factual question is chat, not an agent run.
  if (text.length < 80 && /^(what|why|how|who|when|explain|define|is|are|can you explain)\b/i.test(text) && !/\b(my|our)\b/i.test(text)) scores.chat += 2;

  const ranked = (Object.entries(scores) as Array<[AgentKind, number]>).sort((a, b) => b[1] - a[1]);
  const [agent, top] = ranked[0];
  const second = ranked[1][1];
  const confidence = Math.max(0.35, Math.min(0.98, top / (top + second + 0.5)));

  const missing: Suggestion['missing'] = [];
  const tips: string[] = [];
  const reasons: Record<AgentKind, string> = {
    code: 'This is software work: the Code agent reads and edits files, runs tests in a real sandbox and can push to GitHub.',
    cowork: 'This is an operations task: Co-Work uses your Gmail, Calendar, schedules, MCP servers, skills and browser.',
    image: 'This is a visual: the image pipeline expands your idea into a detailed brief and renders it.',
    video: 'This is a video edit: real ffmpeg runs in a sandbox (cuts, captions, reframing, music).',
    chat: 'A quick question: plain chat answers fastest and costs nothing.',
  };

  if (agent === 'code') {
    if (!ctx.sandbox && !ctx.desktopOnline) missing.push({ what: 'An execution environment', fix: 'Commands will be reported as not run. Open the desktop app or enable Vercel Sandbox.' });
    if (/\b(push|pull request|\bpr\b|github|commit)\b/i.test(text) && !ctx.githubConnected && !ctx.desktopOnline) missing.push({ what: 'GitHub', fix: 'Add a GitHub token in Connections, or connect the desktop app to use your own git.' });
    if (/\b(my (project|repo|code|folder)|locally|on my (mac|computer|machine))\b/i.test(text) && !ctx.desktopOnline) missing.push({ what: 'Desktop app', fix: 'Pair the desktop app so the agent can work in your local folder.' });
    if (!/\b(test|verify|run)\b/i.test(text)) tips.push('Add "and run the tests" so the agent verifies its work.');
  }
  if (agent === 'cowork') {
    if ((tools.has('gmail') || tools.has('calendar')) && !ctx.googleConnected) missing.push({ what: 'Google (Gmail & Calendar)', fix: 'Connect Google in Connections; until then Co-Work can only draft text.' });
    if (tools.has('browser') && !ctx.browserOnline) missing.push({ what: 'Browser extension', fix: 'Install and pair the Shazam Chrome extension to act in your logged-in browser.' });
    if (tools.has('schedule') && !/\b(\d{1,2}(:\d{2})?\s?(am|pm)|morning|noon|evening|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(text)) tips.push('Say when (e.g. "Monday 9am") so it can schedule precisely.');
    const mentioned = ctx.mcpServers.filter((s) => text.toLowerCase().includes(s.toLowerCase()));
    mentioned.forEach((s) => tools.add(`mcp:${s}`));
  }
  if (agent === 'image' && !/\b(16:9|9:16|square|portrait|landscape|poster|banner|story)\b/i.test(text)) tips.push('Mention the format (square, 9:16 story, 16:9 banner).');
  if (agent === 'video' && !/https?:\/\/|\[Attached video/i.test(text)) missing.push({ what: 'A video file', fix: 'Attach the video with the paperclip (or paste a link).' });

  const model = ctx.hasOwnKey
    ? 'Your connected model (best for this task)'
    : agent === 'code'
      ? 'Qwen3 Coder (free)'
      : agent === 'image'
        ? 'FLUX.2 klein (free)'
        : agent === 'video'
          ? 'ffmpeg + Scribe captions'
          : 'Kimi K2 (free)';

  return { agent, confidence: Number(confidence.toFixed(2)), reason: reasons[agent], model, tools: Array.from(tools), missing, tips };
}
