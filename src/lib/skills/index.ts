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
  const text = markdown.replace(/^﻿/, '').replace(/\r\n/g, '\n');
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

/** Inventory text + load_skill tool for an agent run in the given mode. */
export async function buildSkillTools(platform: PlatformRepo, userId: string, mode: AgentMode): Promise<{ tools: ToolSet; inventory: string }> {
  const skills = (await platform.listSkills(userId, mode)).filter((s) => s.enabled);
  if (skills.length === 0) return { tools: {}, inventory: '' };

  const inventory = `Available skills (call load_skill with the slug BEFORE doing a task a skill covers, then follow it):\n${skills
    .map((s) => `- ${s.slug}: ${s.description}`)
    .join('\n')}`;

  const tools: ToolSet = {
    load_skill: tool({
      description: 'Load the full instructions of one of the user\'s skills by slug.',
      inputSchema: z.object({ slug: z.string() }),
      execute: async ({ slug }) => {
        const skill = skills.find((s) => s.slug === slug);
        return skill ? `# Skill: ${skill.name}\n\n${skill.instructions}` : `Error: no enabled skill "${slug}". Available: ${skills.map((s) => s.slug).join(', ')}`;
      },
    }),
  };
  return { tools, inventory };
}
