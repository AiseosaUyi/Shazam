export type ReviewOp = { op: string; aspect?: string; start?: number; end?: number; factor?: number };

export function videoReviewNotes(outputSeconds: number, operations: ReviewOp[]): string {
  const lines: string[] = [];

  // Duration check
  if (!Number.isFinite(outputSeconds) || outputSeconds < 1) {
    lines.push('- ⚠️ The render is under 1 second, so it is probably empty or over-cut. Re-check trim/cut_silences settings and render again.');
  }

  // Trim check
  if (operations.some((op) => op.op === 'trim' && op.start != null && op.end != null && op.end <= op.start)) {
    lines.push('- ⚠️ A trim has end ≤ start.');
  }

  // Captions check
  if (operations.some((op) => op.op === 'captions')) {
    lines.push('- Call transcribe_video on the rendered URL and check that the captions match the speech and nothing is cut mid-word.');
  }

  // Cut silences check
  if (operations.some((op) => op.op === 'cut_silences')) {
    lines.push('- Check that no words were cut off at the edges of cuts (transcribe_video on the result).');
  }

  // Reframe checks
  for (const op of operations) {
    if (op.op === 'reframe' && op.aspect) {
      lines.push(`- Confirm the reframe aspect is ${op.aspect} as asked, and that the speaker stays in frame.`);
    }
  }

  // Always last bullet
  lines.push('- If a check fails, call edit_video again with corrected operations (at most 2 more renders). Then report the final URL and what you checked.');

  return `Review before you report:\n${lines.join('\n')}`;
}
