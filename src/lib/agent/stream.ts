import { streamText, isStepCount, type LanguageModel, type ModelMessage, type ToolSet } from 'ai';

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
}): Promise<{ text: string; steps: number; transcript: string }> {
  const { onEvent } = opts;
  let stepNumber = 0;
  let text = '';
  // The final answer is the last step that said something; earlier "let me check…" narration
  // is progress, not the result.
  let stepText = '';
  let lastSaid = '';

  const result = streamText({
    model: opts.model,
    instructions: opts.instructions,
    messages: opts.messages,
    tools: opts.tools,
    stopWhen: isStepCount(opts.maxSteps),
    abortSignal: opts.signal,
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
  return { text: (lastSaid || text).trim(), steps: stepNumber, transcript: text.trim() };
}
