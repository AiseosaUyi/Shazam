import { PUBLIC_URL } from '@/lib/brand';
import { BridgeRepo, callDevice, type BridgeDevice } from './repo';

/**
 * Local-folder tasks: one clear line when the computer is offline, and on-demand consent
 * (a native "Allow Arcwork to work in …?" prompt on the computer) when the folder is new.
 */

export function connectUrl(): string {
  return `${(process.env.APP_URL || PUBLIC_URL).replace(/\/$/, '')}/connect`;
}

export function offlineMessage(folder?: string): string {
  return `Your computer isn't connected to Arcwork${folder ? `, so it can't work in ${folder}` : ''}. Connect it in one click at ${connectUrl()} (or open the Arcwork desktop app), then run this task again.`;
}

const trimSlash = (p: string) => (p.length > 1 ? p.replace(/\/$/, '') : p);

export function isFolderAllowed(device: BridgeDevice, root: string): boolean {
  const allowed = ((device.capabilities.workspaces as string[]) || []).map(trimSlash);
  const r = trimSlash(root);
  return allowed.some((w) => r === w || r.startsWith(`${w}/`));
}

/**
 * Makes sure the user's online computer allows `root`, asking them on that computer if not.
 * Returns the online device; throws an Error whose message can go straight to the caller.
 */
export async function ensureLocalFolder(userId: string, root: string, opts: { signal?: AbortSignal; repo?: BridgeRepo; timeoutMs?: number } = {}): Promise<BridgeDevice> {
  const repo = opts.repo || new BridgeRepo();
  const device = await repo.onlineDevice(userId, 'desktop');
  if (!device) throw new Error(offlineMessage(root));
  if (isFolderAllowed(device, root)) return device;

  let out: { ok: boolean; result: any };
  try {
    out = await callDevice(userId, 'desktop', 'request_folder', { path: root, reason: 'An Arcwork task wants to work in this folder.' }, { repo, signal: opts.signal, timeoutMs: opts.timeoutMs ?? 120_000 });
  } catch {
    throw new Error(`Nobody answered the prompt on ${device.name} to allow ${root}. Allow it there (or in the Arcwork desktop app), then run this task again.`);
  }
  if (!out.ok) {
    const why = typeof out.result === 'string' ? out.result : '';
    // Bridges older than on-demand consent answer "Unknown command".
    if (/unknown command/i.test(why)) throw new Error(`"${root}" is not an allowed folder on ${device.name}. Add it in the Arcwork desktop app (or update it), then run this task again.`);
    throw new Error(why || `${device.name} refused to share ${root}.`);
  }
  if (!out.result?.allowed) throw new Error(`You didn't allow Arcwork to work in ${root} on ${device.name}, so the task stopped.`);
  const workspaces = Array.isArray(out.result.workspaces) ? out.result.workspaces : [...((device.capabilities.workspaces as string[]) || []), out.result.folder];
  return { ...device, capabilities: { ...device.capabilities, workspaces } };
}
