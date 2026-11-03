import { streamText, isStepCount, type LanguageModel, type ModelMessage, type ToolSet } from 'ai';

/** Lets a long run stop at a time limit and continue later from where it was. */
export interface ResumableRun {
  /** Conversation saved by an earlier segment; when set, the run continues from it. */
  resumeMessages?: ModelMessage[];
  deadline?: number;
  onCheckpoint?: (messages: ModelMessage[]) => void | Promise<void>;
}

export const RESUME_NOTE =
  'You were paused by a time limit and are now resuming. Continue the same task from where you stopped: do not redo finished work, check the current state if unsure, then carry on until the task is done.';

/** The messages a run starts from: a saved checkpoint plus a resume note, or history plus the prompt. */
export function startMessages(prompt: string, history: ModelMessage[] = [], resume?: ModelMessage[]): ModelMessage[] {
  if (resume?.length) return [...resume, { role: 'user', content: RESUME_NOTE }];
  return [...history, { role: 'user', content: prompt }];
}

/**
 * Shared agent loop for Code and Co-Work: native tool calling with streamed progress events.
 * Events: agent_text {delta}, react_step {step, tool, args}, react_observation {step, observation, isError}.
 */
export async function streamAgent(opts: {
  model: LanguageModel;
  instructions: string;
  messages: ModelMessage[];
  tools: ToolSet;
  maxSteps: number;
  signal?: AbortSignal;
  onEvent?: (event: string, data: unknown) => void;
  /** Epoch ms. No new step starts after this; the run pauses with `paused: true` to resume later. */
  deadline?: number;
  /** Called after every step with the whole conversation so far (to resume from). */
  onCheckpoint?: (messages: ModelMessage[]) => void | Promise<void>;
}): Promise<{ text: string; steps: number; transcript: string; paused: boolean; messages: ModelMessage[] }> {
  const { onEvent } = opts;
  let stepNumber = 0;
  let text = '';
  // The final answer is the last step that said something; earlier "let me check…" narration
  // is progress, not the result.
  let stepText = '';
  let lastSaid = '';
  const responseMessages: ModelMessage[] = [];
  let lastFinish: string | undefined;
  let hitDeadline = false;
  const pastDeadline = () => {
    if (opts.deadline && Date.now() >= opts.deadline) hitDeadline = true;
    return hitDeadline;
  };

  const result = streamText({
    model: opts.model,
    instructions: opts.instructions,
    messages: opts.messages,
    tools: opts.tools,
    stopWhen: [isStepCount(opts.maxSteps), pastDeadline],
    abortSignal: opts.signal,
    onStepEnd: async (step) => {
      lastFinish = step.finishReason;
      responseMessages.push(...(step.response.messages as ModelMessage[]));
      await opts.onCheckpoint?.([...opts.messages, ...responseMessages]);
    },
  });

  for await (const part of result.stream) {
    switch (part.type) {
      case 'start-step':
        stepNumber++;
        if (stepText.trim()) lastSaid = stepText;
        stepText = '';
        break;
      case 'text-delta':
        text += part.text;
        stepText += part.text;
        onEvent?.('agent_text', { delta: part.text });
        break;
      case 'tool-call':
        onEvent?.('react_step', { step: stepNumber, thought: '', tool: part.toolName, args: part.input });
        break;
      case 'tool-result': {
        const observation = typeof part.output === 'string' ? part.output : JSON.stringify(part.output);
        onEvent?.('react_observation', {
          step: stepNumber,
          tool: part.toolName,
          observation: observation.slice(0, 4000),
          isError: /^(Error|Edit failed|Blocked|NOT RUN|MCP call failed|Google is not connected)/.test(observation),
        });
        break;
      }
      case 'tool-error':
        onEvent?.('react_observation', { step: stepNumber, observation: `Tool error: ${String((part as any).error?.message || (part as any).error)}`, isError: true });
        break;
      case 'error': {
        const err = (part as any).error;
        throw err instanceof Error ? err : new Error(typeof err === 'string' ? err : JSON.stringify(err));
      }
    }
  }
  if (stepText.trim()) lastSaid = stepText;
  // Paused only when the time limit stopped a run that still wanted to call tools.
  const paused = hitDeadline && lastFinish === 'tool-calls';
  return { text: (lastSaid || text).trim(), steps: stepNumber, transcript: text.trim(), paused, messages: [...opts.messages, ...responseMessages] };
}
