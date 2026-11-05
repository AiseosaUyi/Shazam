/** Safe message from anything thrown. Matches the old `err.message` behaviour for Error-like objects. */
export function errMessage(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') {
    const m = (e as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return '';
}

/** Safe numeric status/statusCode from a thrown error, if any. */
export function errStatus(e: unknown): number | undefined {
  if (e && typeof e === 'object') {
    const o = e as { status?: unknown; statusCode?: unknown };
    if (typeof o.status === 'number') return o.status;
    if (typeof o.statusCode === 'number') return o.statusCode;
  }
  return undefined;
}
