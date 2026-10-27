import { execSync } from 'child_process';
import { AgentPolicyEngine } from './policy-engine';
import { AgentWorkspace } from './workspace';
import { ToolProposal } from '@/types/agent';
import { redactSecrets } from '@/lib/crypto/vault';

export interface ExecutionResult {
  success: boolean;
  action: string;
  output?: string;
  error?: string;
  requiresApproval?: boolean;
  diff?: string;
}

export class AgentExecutor {
  public static async executeTool(
    workspace: AgentWorkspace,
    proposal: ToolProposal,
    approvedByUser = false
  ): Promise<ExecutionResult> {
    const policy = AgentPolicyEngine.evaluateProposal(proposal);

    if (!policy.allowed) {
      return {
        success: false,
        action: proposal.action,
        error: `Policy violation: ${policy.reason}`,
      };
    }

    if (policy.requiresUserApproval && !approvedByUser) {
      return {
        success: false,
        action: proposal.action,
        requiresApproval: true,
        error: `Action requires explicit user confirmation: ${policy.reason}`,
      };
    }

    try {
      switch (proposal.action) {
        case 'list_files': {
          const files = workspace.listFiles(proposal.params.path);
          return {
            success: true,
            action: 'list_files',
            output: JSON.stringify(files, null, 2),
          };
        }

        case 'read_file': {
          if (!proposal.params.path) throw new Error('File path required');
          const content = workspace.readFile(proposal.params.path);
          return {
            success: true,
            action: 'read_file',
            output: content,
          };
        }

        case 'write_file': {
          if (!proposal.params.path || proposal.params.content === undefined) {
            throw new Error('Path and content required for write_file');
          }
          const { path: p, oldContent, newContent } = workspace.writeFile(proposal.params.path, proposal.params.content);
          const diff = workspace.computeDiff(p, oldContent, newContent);
          return {
            success: true,
            action: 'write_file',
            output: `Successfully wrote ${p} (${newContent.length} bytes)`,
            diff,
          };
        }

        case 'create_checkpoint': {
          const desc = proposal.params.checkpointDescription || 'Manual checkpoint';
          const ckpt = workspace.createCheckpoint(desc);
          return {
            success: true,
            action: 'create_checkpoint',
            output: `Checkpoint "${ckpt.id}" created (${Object.keys(ckpt.files).length} files captured).`,
          };
        }

        case 'run_tests':
        case 'execute_command': {
          const cmd = proposal.params.command || 'echo "no command specified"';
          const stdout = execSync(cmd, {
            cwd: workspace.baseDir,
            timeout: 15000,
            maxBuffer: 1024 * 512,
            env: { ...process.env, PATH: process.env.PATH },
          }).toString('utf8');

          return {
            success: true,
            action: proposal.action,
            output: redactSecrets(stdout),
          };
        }

        default:
          return {
            success: false,
            action: (proposal as any).action,
            error: 'Unsupported tool action',
          };
      }
    } catch (err: any) {
      return {
        success: false,
        action: proposal.action,
        error: redactSecrets(err.message || String(err)),
      };
    }
  }
}
