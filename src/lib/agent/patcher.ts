/**
 * Shazam AI Surgical Code Patcher
 * Supports targeted Search-and-Replace patches (Claude / Antigravity standard)
 * and full-file creations without hallucinating or overwriting entire existing codebases.
 */

export interface SearchReplacePatch {
  type: 'search_replace';
  path: string;
  searchBlock: string;
  replaceBlock: string;
}

export interface FullFilePatch {
  type: 'full_file';
  path: string;
  content: string;
}

export type CodePatch = SearchReplacePatch | FullFilePatch;

export interface PatchApplyResult {
  success: boolean;
  updatedContent?: string;
  error?: string;
  linesAdded: number;
  linesDeleted: number;
}

/**
 * Parses both surgical <<<< SEARCH / ==== / >>>> blocks and ### File: blocks from model output.
 */
export function parsePatchesFromText(text: string): CodePatch[] {
  const patches: CodePatch[] = [];

  // 1. Surgical Search & Replace Blocks
  // Pattern: <<<< SEARCH: path/to/file.ext\n[searchLines]\n====\n[replaceLines]\n>>>>
  const searchReplaceRegex = /<<<< SEARCH:\s*([^\n]+)\n([\s\S]*?)\n====\n([\s\S]*?)\n>>>>/g;
  let srMatch;
  while ((srMatch = searchReplaceRegex.exec(text)) !== null) {
    const filePath = srMatch[1].trim();
    const searchBlock = srMatch[2];
    const replaceBlock = srMatch[3];

    patches.push({
      type: 'search_replace',
      path: filePath,
      searchBlock,
      replaceBlock,
    });
  }

  // 2. Full-File Blocks (Used for creating new files or when explicitly formatted)
  // Pattern: ### File: path/to/file.ext\n```lang\n[code]\n```
  const fullFileRegex = /### File:\s*([^\n]+)\n```(?:[a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g;
  let ffMatch;
  while ((ffMatch = fullFileRegex.exec(text)) !== null) {
    const filePath = ffMatch[1].trim();
    const content = ffMatch[2].trim();

    // Avoid duplicate if already covered by search-replace for same file
    if (!patches.some((p) => p.path === filePath && p.type === 'search_replace')) {
      patches.push({
        type: 'full_file',
        path: filePath,
        content,
      });
    }
  }

  return patches;
}

/**
 * Applies a surgical search-replace patch to original file content with whitespace resilience.
 */
export function applySearchReplace(originalContent: string, patch: SearchReplacePatch): PatchApplyResult {
  const { searchBlock, replaceBlock } = patch;

  const linesAdded = replaceBlock.split('\n').length;
  const linesDeleted = searchBlock.split('\n').length;

  // 1. Exact match attempt
  if (originalContent.includes(searchBlock)) {
    const updatedContent = originalContent.replace(searchBlock, replaceBlock);
    return {
      success: true,
      updatedContent,
      linesAdded,
      linesDeleted,
    };
  }

  // 2. Line ending normalization match (\r\n vs \n)
  const normOriginal = originalContent.replace(/\r\n/g, '\n');
  const normSearch = searchBlock.replace(/\r\n/g, '\n');
  const normReplace = replaceBlock.replace(/\r\n/g, '\n');

  if (normOriginal.includes(normSearch)) {
    const updatedContent = normOriginal.replace(normSearch, normReplace);
    return {
      success: true,
      updatedContent,
      linesAdded,
      linesDeleted,
    };
  }

  // 3. Trimmed line-by-line fuzzy match
  const searchLines = normSearch.split('\n').map((l) => l.trimEnd());
  const origLines = normOriginal.split('\n');

  let matchStartIndex = -1;
  for (let i = 0; i <= origLines.length - searchLines.length; i++) {
    let matches = true;
    for (let j = 0; j < searchLines.length; j++) {
      if (origLines[i + j].trimEnd() !== searchLines[j]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      matchStartIndex = i;
      break;
    }
  }

  if (matchStartIndex !== -1) {
    const before = origLines.slice(0, matchStartIndex);
    const after = origLines.slice(matchStartIndex + searchLines.length);
    const updatedContent = [...before, normReplace, ...after].join('\n');
    return {
      success: true,
      updatedContent,
      linesAdded,
      linesDeleted,
    };
  }

  return {
    success: false,
    error: `Could not locate search block in "${patch.path}". Ensure the target code exists and matches indentation.`,
    linesAdded: 0,
    linesDeleted: 0,
  };
}
