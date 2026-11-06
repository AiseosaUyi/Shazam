import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { AgentMode, PlatformRepo, Skill } from '@/lib/db/platform-repo';

/**
 * Skills follow the open SKILL.md format (agentskills.io): YAML frontmatter with `name` and
 * `description`, then markdown instructions. Only name + description enter the context up
 * front; the body is loaded on demand via load_skill (progressive disclosure).
 */

export interface ParsedSkill {
  name: string;
  slug: string;
  description: string;
  instructions: string;
}

export function slugifySkill(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'skill';
}

export function parseSkillMarkdown(markdown: string): ParsedSkill {
  const text = markdown.replace(/^\u{feff}/u, '').replace(/\r\n/g, '\n');
  const fm = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fm) throw new Error('SKILL.md must start with YAML frontmatter (--- name: … description: … ---).');

  const meta: Record<string, string> = {};
  let currentKey: string | null = null;
  for (const line of fm[1].split('\n')) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv) {
      currentKey = kv[1].toLowerCase();
      meta[currentKey] = kv[2].replace(/^["']|["']$/g, '').trim();
    } else if (currentKey && /^\s+\S/.test(line)) {
      // folded / multi-line scalar continuation
      meta[currentKey] = `${meta[currentKey]} ${line.trim()}`.replace(/^[>|]-?\s*/, '').trim();
    }
  }
  const name = (meta.name || '').trim();
  const description = (meta.description || '').trim();
  if (!name) throw new Error('SKILL.md frontmatter is missing `name`.');
  if (!description) throw new Error('SKILL.md frontmatter is missing `description`.');
  if (name.length > 64) throw new Error('Skill name must be 64 characters or fewer.');
  if (description.length > 1024) throw new Error('Skill description must be 1024 characters or fewer.');
  const instructions = fm[2].trim();
  if (!instructions) throw new Error('SKILL.md has no instructions after the frontmatter.');
  return { name, slug: slugifySkill(name), description, instructions };
}

export function toSkillMarkdown(skill: Pick<Skill, 'name' | 'description' | 'instructions'>): string {
  return `---\nname: ${skill.name}\ndescription: ${skill.description.replace(/\n/g, ' ')}\n---\n\n${skill.instructions}\n`;
}

const AGENT_MODES = ['chat', 'cowork', 'code'] as const;

/** Inventory text + load_skill and save_skill tools for an agent run in the given mode. */
export async function buildSkillTools(platform: PlatformRepo, userId: string, mode: AgentMode): Promise<{ tools: ToolSet; inventory: string }> {
  const skills = (await platform.listSkills(userId, mode)).filter((s) => s.enabled);

  const skillListLines = skills.map((s) => `- ${s.slug}: ${s.description}`).join('\n');
  const inventory = skillListLines
    ? `Available skills (call load_skill with the slug BEFORE doing a task a skill covers, then follow it):\n${skillListLines}\nTo create or update a skill, call save_skill.`
    : 'To create or update a skill, call save_skill.';

  const tools: ToolSet = {
    save_skill: tool({
      description:
        'Save a reusable skill for this user (create, or update one with the same name). Use it when the user asks you to remember how to do something, or to turn a workflow you just did into a skill. Write instructions as clear numbered steps.',
      inputSchema: z.object({
        name: z.string().min(1).max(64),
        description: z.string().min(1).max(1024),
        instructions: z.string().min(1).max(20000),
        modes: z.array(z.enum(AGENT_MODES as unknown as [string, ...string[]])).optional(),
      }),
      execute: async ({ name, description, instructions, modes }) => {
        const trimmedName = name.trim();
        const trimmedDescription = description.trim();
        const trimmedInstructions = instructions.trim();

        if (!trimmedName || !trimmedDescription || !trimmedInstructions) {
          return 'Error: name, description and instructions are required.';
        }

        try {
          const s = await platform.upsertSkill(userId, {
            name: trimmedName,
            slug: slugifySkill(trimmedName),
            description: trimmedDescription,
            instructions: trimmedInstructions,
            modes: modes as AgentMode[] | undefined ?? [mode],
            enabled: true,
          });
          return `Saved skill "${s.slug}" (version ${s.version}).`;
        } catch (e) {
          return `Error: ${(e as Error).message}`;
        }
      },
    }),
  };

  if (skills.length > 0) {
    tools.load_skill = tool({
      description: 'Load the full instructions of one of the user\'s skills by slug.',
      inputSchema: z.object({ slug: z.string() }),
      execute: async ({ slug }) => {
        const skill = skills.find((s) => s.slug === slug);
        return skill ? `# Skill: ${skill.name}\n\n${skill.instructions}` : `Error: no enabled skill "${slug}". Available: ${skills.map((s) => s.slug).join(', ')}`;
      },
    });
  }

  return { tools, inventory };
}

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'when', 'use', 'user', 'asks', 'your', 'from', 'into', 'about', 'what', 'have', 'will', 'you', 'are', 'was', 'can', 'any', 'all']);
const words = (t: string) => new Set((t.toLowerCase().match(/[a-z0-9]{4,}/g) || []).filter((w) => !STOP.has(w)));

/**
 * Plain Chat is a single text completion with no tools, so it cannot call load_skill. Instead
 * pick the enabled Chat skills whose name or description clearly matches the request (two shared
 * meaningful words, or the skill name appears in the prompt) and prepend their instructions.
 */
export function pickChatSkills(skills: Array<Pick<Skill, 'name' | 'description' | 'instructions' | 'enabled' | 'modes'>>, prompt: string, max = 2): Array<Pick<Skill, 'name' | 'instructions'>> {
  const promptWords = words(prompt);
  const lower = prompt.toLowerCase();
  return skills
    .filter((s) => s.enabled && s.modes.includes('chat'))
    .map((s) => {
      const shared = [...words(`${s.name} ${s.description}`)].filter((w) => promptWords.has(w)).length;
      const named = lower.includes(s.name.toLowerCase());
      return { s, score: named ? 99 : shared };
    })
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => ({ name: x.s.name, instructions: x.s.instructions.slice(0, 4000) }));
}

export function chatSkillBlock(picked: Array<{ name: string; instructions: string }>): string {
  if (!picked.length) return '';
  return picked.map((s) => `[Skill: ${s.name}] Follow these instructions for this request:\n${s.instructions}`).join('\n\n');
}
