export const MEMORY_FILES = ['ARCWORK.md', 'AGENTS.md', 'CLAUDE.md'] as const;

export function stripLineNumbers(s: string): string {
  return s.replace(/^\s*\d+\t/gm, '');
}

const GUIDANCE = `When you finish, if you learned something durable about this project (build/test commands, conventions, gotchas), append one short bullet per fact under a "## Learnings" heading in ARCWORK.md at the project root, creating the file if needed. Never store secrets there.`;

export async function loadProjectMemory(
  readFile: (p: string) => Promise<string>,
  root: string,
  maxChars = 6000,
): Promise<string> {
  for (const name of MEMORY_FILES) {
    const filePath = `${root}/${name}`;
    try {
      const text = await readFile(filePath);
      if (text.startsWith('Error:')) continue;
      const trimmed = text.trim();
      if (!trimmed) continue;

      let content = stripLineNumbers(text);
      if (content.length > maxChars) {
        content = content.slice(0, maxChars) + '\n…(truncated)';
      }
      return `## Project memory (${name})\nThe project's own notes. Follow them.\n\n${content}\n\n${GUIDANCE}`;
    } catch {
      continue;
    }
  }

  return GUIDANCE;
}
