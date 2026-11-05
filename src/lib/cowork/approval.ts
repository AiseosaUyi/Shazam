import type { PendingAction, PlatformRepo } from '@/lib/db/platform-repo';
import { executeApprovedAction } from '@/lib/cowork/actions';

/**
 * Approval policy for Co-Work actions.
 *  - ask:   every outward action waits for the user.
 *  - smart: actions that only touch the user themselves (their own inbox, their own calendar,
 *           their own schedule) just run. Anything that reaches another person or mutates an
 *           external system still asks.
 *  - auto:  everything runs.
 */
export type ApprovalMode = 'ask' | 'smart' | 'auto';

export interface ApprovalPolicy {
  mode: ApprovalMode;
  /** Addresses that belong to the user (account email, connected Google account). */
  selfEmails: string[];
}

export const APPROVAL_MODES: ApprovalMode[] = ['ask', 'smart', 'auto'];

export function normalizeApprovalMode(v: unknown): ApprovalMode {
  return v === 'ask' || v === 'auto' ? v : 'smart';
}

function emails(v: unknown): string[] {
  if (!v) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.map((x) => String(x).toLowerCase().trim()).filter(Boolean);
}

export function allSelf(addresses: string[], self: string[]): boolean {
  const mine = new Set(self.map((s) => s.toLowerCase().trim()).filter(Boolean));
  return mine.size > 0 && addresses.every((a) => mine.has(a));
}

/** True when the action may run without asking the user. */
export function shouldAutoApprove(policy: ApprovalPolicy | undefined, kind: string, payload: any): boolean {
  if (!policy || policy.mode === 'ask') return false;
  if (policy.mode === 'auto') return true;

  const p = payload || {};
  switch (kind) {
    case 'gmail_send':
    case 'schedule_email': {
      const to = [...emails(p.to), ...emails(p.cc), ...emails(p.bcc)];
      return to.length > 0 && allSelf(to, policy.selfEmails);
    }
    case 'calendar_create': {
      const attendees = emails(p.attendees);
      return attendees.length === 0 || allSelf(attendees, policy.selfEmails);
    }
    case 'schedule_task': {
      const out = emails(p.emailResultTo);
      return out.length === 0 || allSelf(out, policy.selfEmails);
    }
    default:
      // mcp_call and anything unknown: external side effects we cannot judge.
      return false;
  }
}

export interface ProposeResult {
  auto: boolean;
  action: PendingAction;
  ok?: boolean;
  result?: string;
}

/**
 * Records the action and, when the policy allows, runs it right away through the same
 * exactly-once path the approve button uses. Otherwise leaves it pending for the user.
 */
export async function proposeOrRun(
  platform: PlatformRepo,
  userId: string,
  kind: string,
  summary: string,
  payload: unknown,
  policy?: ApprovalPolicy
): Promise<ProposeResult> {
  const action = await platform.createPendingAction(userId, kind, summary, payload);
  if (!shouldAutoApprove(policy, kind, payload)) return { auto: false, action };
  if (!(await platform.decidePendingAction(userId, action.id, 'approved'))) return { auto: false, action };
  const outcome = await executeApprovedAction(action, platform);
  await platform.completePendingAction(userId, action.id, outcome.ok, outcome.result);
  return { auto: true, action, ok: outcome.ok, result: outcome.result };
}
