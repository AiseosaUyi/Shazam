import { Sandbox } from '@vercel/sandbox';

/**
 * Real command execution for the agent: one persistent Vercel Sandbox (Firecracker microVM)
 * per user project. Project files are mirrored into /vercel/sandbox before each command.
 *
 * Auth is automatic on Vercel (OIDC); locally it uses VERCEL_OIDC_TOKEN from `vercel env pull`.
 */

export function sandboxAvailable(): boolean {
  return Boolean(process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL_TOKEN || process.env.VERCEL);
}

export interface CommandResult {
  exitCode: number;
  output: string;
}

function sandboxName(userId: string, projectId: string): string {
  return `shazam-${userId}-${projectId}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 63);
}

export class ProjectSandbox {
  private sandbox: Sandbox | null = null;
  private synced = new Map<string, string>();

  constructor(private userId: string, private projectId: string) {}

  private async get(): Promise<Sandbox> {
    if (!this.sandbox) {
      this.sandbox = await Sandbox.getOrCreate({
        name: sandboxName(this.userId, this.projectId),
        runtime: 'node24',
        timeout: 15 * 60 * 1000,
        ports: [3000, 5173],
      });
    }
    return this.sandbox;
  }

  /** Writes changed project files into the sandbox (only files whose content differs). */
  async sync(files: Array<{ path: string; content: string }>): Promise<void> {
    const changed = files.filter((f) => this.synced.get(f.path) !== f.content);
    if (changed.length === 0) return;
    const sbx = await this.get();
    for (let i = 0; i < changed.length; i += 50) {
      await sbx.writeFiles(changed.slice(i, i + 50).map((f) => ({ path: f.path, content: f.content })));
    }
    for (const f of changed) this.synced.set(f.path, f.content);
  }

  async run(command: string, timeoutMs = 120_000, signal?: AbortSignal, env?: Record<string, string>): Promise<CommandResult> {
    const sbx = await this.get();
    const result = env
      ? await sbx.runCommand({
          cmd: 'bash',
          args: ['-lc', command],
          env,
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
        } as any)
      : await sbx.runCommand('bash', ['-lc', command], { timeoutMs, signal });
    const output = await result.output('both');
    return { exitCode: result.exitCode, output };
  }

  /** Starts a dev server in the background and returns its public preview URL. */
  async startPreview(command: string, port: number): Promise<{ url: string; output: string }> {
    const sbx = await this.get();
    const cmd = await sbx.runCommand({ cmd: 'bash', args: ['-lc', command], detached: true } as any);
    await new Promise((r) => setTimeout(r, 6000));
    let output = '';
    try {
      output = await (cmd as any).output?.('both', { signal: AbortSignal.timeout(2000) });
    } catch {
      // still running; output is streamed
    }
    return { url: sbx.domain(port), output: output || '' };
  }

  /** Reads a file the command produced (e.g. a rendered video) back out of the sandbox. */
  async readBinary(path: string): Promise<Buffer | null> {
    const sbx = await this.get();
    return sbx.readFileToBuffer({ path });
  }

  async writeBinary(path: string, content: Uint8Array): Promise<void> {
    const sbx = await this.get();
    await sbx.writeFiles([{ path, content }]);
  }
}
