import { googleFetch, getGoogleAccessToken } from './oauth';

/** Gmail REST v1 helpers. */

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

export interface OutgoingEmail {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  /** Treat body as HTML. Plain text otherwise. */
  html?: boolean;
  inReplyToThreadId?: string;
}

const EMAIL_RX = /^[^\s@<>,"]+@[^\s@<>,"]+\.[^\s@<>,"]+$/;

export function validateRecipients(list: string[]): string[] {
  const clean = list.map((e) => e.trim()).filter(Boolean);
  const bad = clean.filter((e) => !EMAIL_RX.test(e));
  if (bad.length) throw new Error(`Invalid email address: ${bad.join(', ')}`);
  if (clean.length === 0) throw new Error('At least one recipient is required.');
  return clean;
}

function encodeHeader(value: string): string {
  // RFC 2047 so non-ASCII subjects (emoji, accents) survive.
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/** Builds a base64url RFC 2822 message. Header values are stripped of CR/LF (header injection). */
export function buildRawMessage(email: OutgoingEmail, from?: string | null): string {
  const strip = (v: string) => v.replace(/[\r\n]+/g, ' ');
  const headers = [
    from ? `From: ${strip(from)}` : null,
    `To: ${validateRecipients(email.to).join(', ')}`,
    email.cc?.length ? `Cc: ${validateRecipients(email.cc).join(', ')}` : null,
    email.bcc?.length ? `Bcc: ${validateRecipients(email.bcc).join(', ')}` : null,
    `Subject: ${encodeHeader(strip(email.subject))}`,
    'MIME-Version: 1.0',
    `Content-Type: ${email.html ? 'text/html' : 'text/plain'}; charset="UTF-8"`,
    'Content-Transfer-Encoding: base64',
  ].filter(Boolean);
  const body = Buffer.from(email.body, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
  return Buffer.from(`${headers.join('\r\n')}\r\n\r\n${body}`, 'utf8').toString('base64url');
}

export async function sendGmail(userId: string, email: OutgoingEmail): Promise<{ id: string; threadId: string }> {
  const { email: from } = await getGoogleAccessToken(userId);
  return googleFetch(userId, `${GMAIL}/messages/send`, {
    method: 'POST',
    body: JSON.stringify({ raw: buildRawMessage(email, from), threadId: email.inReplyToThreadId }),
  });
}

export async function createGmailDraft(userId: string, email: OutgoingEmail): Promise<{ id: string }> {
  const { email: from } = await getGoogleAccessToken(userId);
  return googleFetch(userId, `${GMAIL}/drafts`, {
    method: 'POST',
    body: JSON.stringify({ message: { raw: buildRawMessage(email, from), threadId: email.inReplyToThreadId } }),
  });
}

function header(msg: any, name: string): string {
  return msg.payload?.headers?.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

function extractText(part: any): string {
  if (!part) return '';
  if (part.mimeType === 'text/plain' && part.body?.data) return Buffer.from(part.body.data, 'base64url').toString('utf8');
  for (const p of part.parts || []) {
    const t = extractText(p);
    if (t) return t;
  }
  if (part.mimeType === 'text/html' && part.body?.data) {
    return Buffer.from(part.body.data, 'base64url').toString('utf8').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  }
  return '';
}

export async function searchGmail(userId: string, query: string, max = 10): Promise<Array<{ id: string; threadId: string; from: string; subject: string; date: string; snippet: string }>> {
  const list = await googleFetch(userId, `${GMAIL}/messages?${new URLSearchParams({ q: query, maxResults: String(Math.min(max, 25)) })}`);
  const out = [];
  for (const m of list.messages || []) {
    const msg = await googleFetch(userId, `${GMAIL}/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
    out.push({ id: msg.id, threadId: msg.threadId, from: header(msg, 'From'), subject: header(msg, 'Subject'), date: header(msg, 'Date'), snippet: msg.snippet || '' });
  }
  return out;
}

export async function readGmail(userId: string, id: string): Promise<{ from: string; to: string; subject: string; date: string; body: string; threadId: string }> {
  const msg = await googleFetch(userId, `${GMAIL}/messages/${encodeURIComponent(id)}?format=full`);
  return {
    from: header(msg, 'From'),
    to: header(msg, 'To'),
    subject: header(msg, 'Subject'),
    date: header(msg, 'Date'),
    threadId: msg.threadId,
    body: extractText(msg.payload).slice(0, 20000),
  };
}
