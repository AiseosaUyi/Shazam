/**
 * Shazam AI Codebase Symbol & Outline Indexer
 * Extracts high-fidelity project outlines (exported functions, classes, interfaces, components, scripts)
 * without naive file truncation so the AI agent understands the entire codebase architecture.
 */

export interface FileOutline {
  path: string;
  size: number;
  lines: number;
  exports: string[];
  imports: string[];
  declarations: string[];
}

export interface ProjectIndex {
  tree: string[];
  keyConfigs: Record<string, string>;
  outlines: FileOutline[];
  summaryPrompt: string;
}

/**
 * Extracts TypeScript / JavaScript / Python / Rust declarations from code content
 */
export function extractSymbolsFromContent(content: string): { exports: string[]; imports: string[]; declarations: string[] } {
  const exports: string[] = [];
  const imports: string[] = [];
  const declarations: string[] = [];

  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Imports
    if (/^import\s+/.test(trimmed) || /^from\s+[\w.]+\s+import/.test(trimmed)) {
      if (imports.length < 15) {
        imports.push(trimmed.replace(/\s+/g, ' ').slice(0, 100));
      }
    }

    // Exports & Declarations
    if (/^export\s+(default\s+)?(function|class|interface|type|const|let|enum|async\s+function)\s+([A-Za-z0-9_]+)/.test(trimmed)) {
      const match = trimmed.match(/^export\s+(default\s+)?(function|class|interface|type|const|let|enum|async\s+function)\s+([A-Za-z0-9_]+)/);
      if (match) {
        exports.push(match[0].replace(/\s+/g, ' '));
        declarations.push(match[3]);
      }
    } else if (/^(function|class|interface|type|const|let|enum|def|pub\s+fn)\s+([A-Za-z0-9_]+)/.test(trimmed)) {
      const match = trimmed.match(/^(function|class|interface|type|const|let|enum|def|pub\s+fn)\s+([A-Za-z0-9_]+)/);
      if (match && !trimmed.startsWith('//') && !trimmed.startsWith('*')) {
        declarations.push(match[2]);
      }
    }
  }

  return {
    exports: Array.from(new Set(exports)).slice(0, 20),
    imports: Array.from(new Set(imports)).slice(0, 10),
    declarations: Array.from(new Set(declarations)).slice(0, 25),
  };
}

/**
 * Builds a high-density, token-efficient project context index.
 */
export function buildProjectIndex(files: Array<{ path: string; content: string }>): ProjectIndex {
  const tree = files.map((f) => f.path);
  const keyConfigs: Record<string, string> = {};
  const outlines: FileOutline[] = [];

  for (const file of files) {
    const isConfig = /package\.json|tsconfig\.json|requirements\.txt|README\.md|wrangler\.json|wrangler\.toml|Cargo\.toml|go\.mod/i.test(file.path);

    if (isConfig && Object.keys(keyConfigs).length < 5) {
      keyConfigs[file.path] = file.content.slice(0, 2000);
    }

    const symbols = extractSymbolsFromContent(file.content);
    outlines.push({
      path: file.path,
      size: file.content.length,
      lines: file.content.split('\n').length,
      exports: symbols.exports,
      imports: symbols.imports,
      declarations: symbols.declarations,
    });
  }

  // Construct structured prompt context
  const treeSection = `Project File Tree (${tree.length} files):\n` + tree.slice(0, 50).map((p) => `- ${p}`).join('\n') + (tree.length > 50 ? `\n... (${tree.length - 50} more files)` : '');

  const configsSection = Object.entries(keyConfigs)
    .map(([path, content]) => `Config: ${path}\n\`\`\`\n${content}\n\`\`\``)
    .join('\n\n');

  const outlinesSection = outlines
    .filter((o) => o.exports.length > 0 || o.declarations.length > 0)
    .slice(0, 40)
    .map((o) => {
      const parts = [`File: ${o.path} (${o.lines} lines)`];
      if (o.exports.length > 0) parts.push(`  Exports: ${o.exports.join(', ')}`);
      if (o.declarations.length > 0) parts.push(`  Symbols: ${o.declarations.slice(0, 10).join(', ')}`);
      return parts.join('\n');
    })
    .join('\n\n');

  const summaryPrompt = [
    treeSection,
    configsSection,
    `Codebase Symbol Outlines:\n${outlinesSection}`,
  ].filter(Boolean).join('\n\n');

  return {
    tree,
    keyConfigs,
    outlines,
    summaryPrompt,
  };
}
