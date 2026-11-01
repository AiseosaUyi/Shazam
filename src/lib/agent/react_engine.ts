/**
 * Arcwork Autonomous Multi-Step ReAct Engine (Reason + Act)
 * Implements Claude Code / Antigravity style autonomous tool-calling loops with
 * surgical diffing, automated compiler/test verification, and self-correction.
 */

import { parsePatchesFromText, applySearchReplace, type SearchReplacePatch } from './patcher';
import { buildProjectIndex } from './indexer';
import { validateFilePath } from './policy';

export interface AgentTool {
  name: string;
  description: string;
  parameters: string;
}

export interface ReActStep {
  step: number;
  thought: string;
  action: {
    tool: string;
    args: Record<string, any>;
  };
  observation: string;
  isError: boolean;
  timestamp: string;
}

export interface ReActContext {
  projectName: string;
  files: Array<{ path: string; content: string }>;
  daemonUrl?: string;
  daemonToken?: string;
  maxTurns?: number;
  onEvent?: (event: string, data: any) => void;
  invokeLLM: (messages: Array<{ role: string; content: string }>) => Promise<string>;
}

export interface ReActResult {
  steps: ReActStep[];
  filesModified: string[];
  finalSummary: string;
  success: boolean;
}

export const AGENT_TOOLS: AgentTool[] = [
  {
    name: 'read_file',
    description: 'Read the contents of a specific file, optionally specifying line boundaries.',
    parameters: '{"path": "string", "startLine": number, "endLine": number}',
  },
  {
    name: 'list_files',
    description: 'List project file paths, optionally filtered by a path prefix (e.g. "src/").',
    parameters: '{"prefix": "string"}',
  },
  {
    name: 'search_code',
    description: 'Case-insensitive text search across all project files. Returns matching lines as path:line: text.',
    parameters: '{"query": "string"}',
  },
  {
    name: 'edit_file',
    description: 'Surgically replace a unique block of text inside an existing file without deleting the rest of the file.',
    parameters: '{"path": "string", "searchBlock": "string", "replaceBlock": "string"}',
  },
  {
    name: 'create_file',
    description: 'Create a brand new file with the specified content.',
    parameters: '{"path": "string", "content": "string"}',
  },
  {
    name: 'run_command',
    description: 'Execute a shell command (e.g. npm test, tsc --noEmit) on the connected local bridge. If no bridge is connected the command is NOT run and you must say so.',
    parameters: '{"command": "string"}',
  },
  {
    name: 'finish_task',
    description: 'Conclude the autonomous task with a comprehensive final summary once all edits and tests pass.',
    parameters: '{"summary": "string"}',
  },
];

/**
 * Builds the ReAct system prompt instructing the agent on structured tool calling.
 */
export function buildReActSystemPrompt(projectSummary: string): string {
  const toolsFormatted = AGENT_TOOLS.map(
    (t) => `- ${t.name}(${t.parameters}): ${t.description}`
  ).join('\n');

  return `You are Arcwork, a elite autonomous software engineer running in a ReAct loop.
You have full authority to read files, surgically modify code, run test commands to verify your changes, and self-correct any errors before concluding.

Project Overview:
${projectSummary}

Available Tools:
${toolsFormatted}

Rules:
1. Always state your reasoning first:
THOUGHT: <your reasoning for the next step>
2. Choose exactly ONE action per turn formatted strictly as:
ACTION: tool_name {"arg": "value"}
3. The ACTION arguments must be a single valid JSON object. Escape newlines inside strings as \n.
4. Explore before editing: use list_files, search_code and read_file. Never guess file contents.
5. When editing existing code, ALWAYS use edit_file with a searchBlock copied exactly from read_file output. NEVER overwrite whole existing files. Use create_file only for new files.
6. After editing code, run a test or typecheck command (e.g. run_command {"command": "npm test"}) to verify your fix.
7. If a test fails, inspect the error output from OBSERVATION and call edit_file again to self-correct.
8. Never claim tests passed unless an OBSERVATION shows real passing output. If commands could not run, say so in the summary.
9. When the task is done, call finish_task {"summary": "..."} listing the files you changed.
`;
}

/**
 * Extracts the first balanced JSON object starting at or after `from`, ignoring
 * braces that appear inside JSON strings (code payloads are full of them).
 */
function extractJsonObject(text: string, from: number): string | null {
  const start = text.indexOf('{', from);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Parses the model's output for THOUGHT and ACTION
 */
export function parseReActTurn(output: string): { thought: string; tool: string; args: Record<string, any> } | null {
  const thoughtMatch = output.match(/THOUGHT:\s*([\s\S]*?)(?=ACTION:|$)/i);
  const actionMatch = output.match(/ACTION:\s*`*([a-zA-Z0-9_-]+)`*/i);

  if (!actionMatch) {
    // Check if model concluded naturally or wrote finish
    if (/finish_task/i.test(output) || /all done|task complete/i.test(output)) {
      return {
        thought: thoughtMatch ? thoughtMatch[1].trim() : 'Task completed.',
        tool: 'finish_task',
        args: { summary: output.replace(/THOUGHT:/gi, '').trim() },
      };
    }
    return null;
  }

  const tool = actionMatch[1].trim();
  const rawArgs = extractJsonObject(output, (actionMatch.index ?? 0) + actionMatch[0].length);
  let args: Record<string, any> = {};
  if (rawArgs) {
    try {
      args = JSON.parse(rawArgs);
    } catch {
      args = { raw: rawArgs };
    }
  }

  return {
    thought: thoughtMatch ? thoughtMatch[1].trim() : 'Evaluating next action...',
    tool,
    args,
  };
}

/**
 * Executes the autonomous multi-turn ReAct agent loop.
 */
export async function executeReActLoop(
  initialPrompt: string,
  context: ReActContext
): Promise<ReActResult> {
  const { projectName, files, daemonUrl, daemonToken, maxTurns = 20, onEvent, invokeLLM } = context;

  // Build project symbol and tree index
  const index = buildProjectIndex(files);
  const systemPrompt = buildReActSystemPrompt(index.summaryPrompt);

  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: initialPrompt },
  ];

  const steps: ReActStep[] = [];
  const filesModified = new Set<string>();
  let finalSummary = '';
  let success = false;
  let formatNudges = 0;

  for (let turn = 1; turn <= maxTurns; turn++) {
    // 1. Invoke LLM for next thought & action
    const response = await invokeLLM(messages);
    const parsed = parseReActTurn(response);

    if (!parsed) {
      // Free models often drift into prose. Remind them of the protocol a couple of
      // times before accepting the prose as the final answer.
      if (formatNudges < 2 && filesModified.size === 0) {
        formatNudges++;
        messages.push({ role: 'assistant', content: response });
        messages.push({
          role: 'user',
          content: 'OBSERVATION: No tool call found. Do not paste code into chat. Respond with THOUGHT: ... then exactly one ACTION: tool_name {json}. Use create_file / edit_file to write code.',
        });
        continue;
      }
      finalSummary = response;
      success = filesModified.size > 0;
      break;
    }

    const { thought, tool, args } = parsed;

    onEvent?.('react_step', {
      step: turn,
      thought,
      tool,
      args,
    });

    // 2. Conclude if finished
    if (tool === 'finish_task') {
      finalSummary = args.summary || args.raw || thought || 'Task concluded successfully.';
      success = true;
      steps.push({
        step: turn,
        thought,
        action: { tool, args },
        observation: 'Task completed.',
        isError: false,
        timestamp: new Date().toISOString(),
      });
      break;
    }

    // 3. Execute tool
    let observation = '';
    let isError = false;

    try {
      const pathCheck = (tool === 'edit_file' || tool === 'create_file') ? validateFilePath(args.path) : { valid: true };
      if (!pathCheck.valid) {
        observation = `Blocked by safety policy: ${pathCheck.error}`;
        isError = true;
      } else if (args.raw !== undefined && tool !== 'finish_task') {
        observation = `Error: ACTION arguments for ${tool} were not valid JSON. Re-send them as one JSON object with newlines escaped as \\n.`;
        isError = true;
      } else if (tool === 'list_files') {
        const prefix = String(args.prefix || '').toLowerCase();
        const paths = files.map((f) => f.path).filter((p) => p.toLowerCase().startsWith(prefix));
        observation = paths.length > 0 ? paths.slice(0, 300).join('\n') : 'No files found (the project may be empty; use create_file).';
      } else if (tool === 'search_code') {
        const query = String(args.query || '').toLowerCase();
        const hits: string[] = [];
        if (query) {
          for (const f of files) {
            f.content.split('\n').forEach((line, i) => {
              if (hits.length < 80 && line.toLowerCase().includes(query)) hits.push(`${f.path}:${i + 1}: ${line.trim().slice(0, 200)}`);
            });
          }
        }
        observation = hits.length > 0 ? hits.join('\n') : `No matches for "${args.query}".`;
      } else if (tool === 'read_file') {
        const filePath = args.path;
        const targetFile = files.find((f) => f.path.toLowerCase() === filePath?.toLowerCase());
        if (targetFile) {
          const lines = targetFile.content.split('\n');
          const start = args.startLine ? Math.max(1, args.startLine) : 1;
          const end = args.endLine ? Math.min(lines.length, args.endLine) : lines.length;
          const slice = lines.slice(start - 1, end).map((l, i) => `${start + i}: ${l}`).join('\n');
          observation = `Content of ${filePath} (lines ${start}-${end}):\n${slice}`;
        } else {
          observation = `Error: File "${filePath}" not found in project.`;
          isError = true;
        }
      } else if (tool === 'edit_file') {
        const filePath = args.path;
        const targetFile = files.find((f) => f.path.toLowerCase() === filePath?.toLowerCase());
        if (!targetFile) {
          observation = `Error: Cannot edit nonexistent file "${filePath}". Use create_file instead.`;
          isError = true;
        } else {
          const patch: SearchReplacePatch = {
            type: 'search_replace',
            path: filePath,
            searchBlock: args.searchBlock || '',
            replaceBlock: args.replaceBlock || '',
          };
          const patchResult = applySearchReplace(targetFile.content, patch);
          if (patchResult.success && patchResult.updatedContent !== undefined) {
            targetFile.content = patchResult.updatedContent;
            filesModified.add(filePath);
            observation = `Successfully updated ${filePath} (+${patchResult.linesAdded}, -${patchResult.linesDeleted} lines).`;

            // If daemon connected, apply patch on disk
            if (daemonUrl && daemonToken) {
              await fetch(`${daemonUrl}/api/files/patch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-shazam-token': daemonToken },
                body: JSON.stringify({ filePath, searchBlock: patch.searchBlock, replaceBlock: patch.replaceBlock }),
              }).catch(() => {});
            }
          } else {
            observation = `Patch Error: ${patchResult.error || 'Search block not found.'}`;
            isError = true;
          }
        }
      } else if (tool === 'create_file') {
        const filePath = args.path;
        const content = args.content || '';
        const existing = files.find((f) => f.path.toLowerCase() === filePath?.toLowerCase());
        if (existing) {
          existing.content = content;
        } else {
          files.push({ path: filePath, content });
        }
        filesModified.add(filePath);
        observation = `File ${filePath} created successfully (${content.length} bytes).`;

        if (daemonUrl && daemonToken) {
          await fetch(`${daemonUrl}/api/files/write`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-shazam-token': daemonToken },
            body: JSON.stringify({ filePath, content }),
          }).catch(() => {});
        }
      } else if (tool === 'run_command') {
        const cmd = args.command;
        if (daemonUrl && daemonToken) {
          // Execute on real companion daemon
          const res = await fetch(`${daemonUrl}/api/exec`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-shazam-token': daemonToken },
            body: JSON.stringify({ command: cmd }),
          });
          const text = await res.text();
          observation = `Command Output ($ ${cmd}):\n${text.slice(-4000)}`;
          isError = !res.ok || /\bERR|failed|exit code [1-9]/.test(text);
        } else {
          observation = `NOT RUN: "$ ${cmd}" was not executed because no local bridge or sandbox is connected. Do not claim it passed; mention in your summary that verification is pending.`;
          isError = true;
        }
      } else {
        observation = `Unknown tool: "${tool}". Supported tools: ${AGENT_TOOLS.map((t) => t.name).join(', ')}`;
        isError = true;
      }
    } catch (err: any) {
      observation = `Execution Exception in ${tool}: ${err.message}`;
      isError = true;
    }

    onEvent?.('react_observation', {
      step: turn,
      observation,
      isError,
    });

    steps.push({
      step: turn,
      thought,
      action: { tool, args },
      observation,
      isError,
      timestamp: new Date().toISOString(),
    });

    // 4. Append turn to assistant and user observation to model context
    messages.push({
      role: 'assistant',
      content: `THOUGHT: ${thought}\nACTION: ${tool} ${JSON.stringify(args)}`,
    });
    messages.push({
      role: 'user',
      content: `OBSERVATION: ${observation}`,
    });
  }

  return {
    steps,
    filesModified: Array.from(filesModified),
    finalSummary: finalSummary || 'Autonomous task execution concluded.',
    success,
  };
}
