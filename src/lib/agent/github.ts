import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { ProjectSandbox } from './sandbox';
import { errMessage } from '@/lib/errors';

/**
 * GitHub from the cloud sandbox, using the user's own fine-grained token (Connections →
 * GitHub). The token is passed as an env var and never appears in command text or output.
 */

const REPO_RX = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

async function gh(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'shazam-ai', ...(init.headers || {}) },
    signal: AbortSignal.timeout(20000),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${data.message || 'request failed'}`);
  return data;
}

export function buildGithubTools(token: string, sandbox: ProjectSandbox, files: Array<{ path: string; content: string }>): ToolSet {
  const redact = (s: string) => s.split(token).join('***');

  return {
    github_push: tool({
      description: 'Commit the current project files and push them to a GitHub repo branch (creates the repo if missing). Use a feature branch, then github_create_pr.',
      inputSchema: z.object({
        repo: z.string().describe('owner/name'),
        branch: z.string().regex(/^[A-Za-z0-9._\/-]+$/),
        message: z.string().min(3).max(500),
        create_if_missing: z.boolean().optional(),
        private: z.boolean().optional(),
      }),
      execute: async ({ repo, branch, message, create_if_missing, private: isPrivate }) => {
        if (!REPO_RX.test(repo)) return 'Error: repo must look like owner/name.';
        try {
          const me = await gh(token, '/user');
          try {
            await gh(token, `/repos/${repo}`);
          } catch (err) {
            if (!create_if_missing || !/404/.test(errMessage(err))) throw err;
            const [owner, name] = repo.split('/');
            await gh(token, owner === me.login ? '/user/repos' : `/orgs/${owner}/repos`, { method: 'POST', body: JSON.stringify({ name, private: isPrivate !== false, auto_init: false }) });
          }
          await sandbox.sync(files);
          const script = [
            'set -e',
            'cd /vercel/sandbox',
            '[ -d .git ] || git init -q',
            `git config user.name ${JSON.stringify(me.name || me.login)}`,
            `git config user.email ${JSON.stringify(`${me.id}+${me.login}@users.noreply.github.com`)}`,
            'printf "node_modules/\\n.env*\\n" >> .git/info/exclude',
            `git checkout -q -B ${JSON.stringify(branch)}`,
            'git add -A',
            `git commit -q -m ${JSON.stringify(message)} || echo "nothing new to commit"`,
            `git push -q "https://x-access-token:$GH_TOKEN@github.com/${repo}.git" ${JSON.stringify(`HEAD:refs/heads/${branch}`)} 2>&1`,
            'git log --oneline -1',
          ].join('\n');
          const r = await sandbox.run(script, 120_000, undefined, { GH_TOKEN: token });
          return redact(`exit code: ${r.exitCode}\n${r.output}\n${r.exitCode === 0 ? `Pushed to https://github.com/${repo}/tree/${branch}` : ''}`);
        } catch (err) {
          return redact(`Error: ${errMessage(err)}`);
        }
      },
    }),
    github_create_pr: tool({
      description: 'Open a pull request on GitHub.',
      inputSchema: z.object({ repo: z.string(), head: z.string(), base: z.string().optional(), title: z.string(), body: z.string().optional() }),
      execute: async ({ repo, head, base, title, body }) => {
        if (!REPO_RX.test(repo)) return 'Error: repo must look like owner/name.';
        try {
          const info = await gh(token, `/repos/${repo}`);
          const pr = await gh(token, `/repos/${repo}/pulls`, { method: 'POST', body: JSON.stringify({ head, base: base || info.default_branch, title, body: body || '' }) });
          return `Opened PR #${pr.number}: ${pr.html_url}`;
        } catch (err) {
          return redact(`Error: ${errMessage(err)}`);
        }
      },
    }),
    github_clone: tool({
      description: 'Clone a GitHub repo into the sandbox to inspect or run it (files are not imported into the project).',
      inputSchema: z.object({ repo: z.string(), branch: z.string().optional() }),
      execute: async ({ repo, branch }) => {
        if (!REPO_RX.test(repo)) return 'Error: repo must look like owner/name.';
        const r = await sandbox.run(`set -e; rm -rf /vercel/sandbox/_clone; git clone -q --depth 50 ${branch ? `-b ${JSON.stringify(branch)}` : ''} "https://x-access-token:$GH_TOKEN@github.com/${repo}.git" /vercel/sandbox/_clone && cd /vercel/sandbox/_clone && git log --oneline -3 && ls`, 180_000, undefined, { GH_TOKEN: token });
        return redact(`exit code: ${r.exitCode}\n${r.output}\nCloned into /vercel/sandbox/_clone — use run_command with "cd _clone && ..."`);
      },
    }),
  };
}
