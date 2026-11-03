/** Regular expression that validates an Ollama model name. */
export const MODEL_NAME_RE = /^[a-z0-9][a-z0-9._-]*(:[a-z0-9._-]+)?$/i;

/**
 * Returns true if `name` is a valid Ollama model name (non-empty string,
 * ≤ 100 characters, matches MODEL_NAME_RE).
 */
export function isValidModelName(name: unknown): name is string {
  if (typeof name !== 'string') return false;
  if (name.length > 100) return false;
  if (name.length === 0) return false;
  return MODEL_NAME_RE.test(name);
}

/**
 * Given the device's RAM in GB, recommend an appropriate local Ollama model.
 */
export function recommendModel(ramGB: number): { model: string; sizeGB: number; reason: string } {
  // Non-finite or negative → smallest tier
  if (!Number.isFinite(ramGB) || ramGB < 0) {
    return {
      model: 'qwen2.5-coder:3b',
      sizeGB: 1.9,
      reason: 'RAM is insufficient for a larger model; using the smallest available option.',
    };
  }

  if (ramGB >= 48) {
    return {
      model: 'qwen3.6:35b-a3b',
      sizeGB: 23,
      reason: `Fits comfortably in ${ramGB} GB of memory.`,
    };
  }

  if (ramGB >= 24) {
    return {
      model: 'qwen2.5-coder:14b',
      sizeGB: 9,
      reason: `Fits comfortably in ${ramGB} GB of memory.`,
    };
  }

  if (ramGB >= 12) {
    return {
      model: 'qwen2.5-coder:7b',
      sizeGB: 4.7,
      reason: `Fits comfortably in ${ramGB} GB of memory.`,
    };
  }

  return {
    model: 'qwen2.5-coder:3b',
    sizeGB: 1.9,
    reason: `RAM is limited; using the smallest available option.`,
  };
}
