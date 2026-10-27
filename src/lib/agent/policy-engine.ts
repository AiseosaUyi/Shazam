import { PolicyCheckResult, ToolProposal } from '@/types/agent';

export class AgentPolicyEngine {
  // Prohibited dangerous shell patterns
  private static DANGEROUS_PATTERNS = [
    /\brm\s+-[rf]{1,2}\s+\//i, // rm -rf /
    /\bcurl\b/i,
    /\bwget\b/i,
    /\bnc\b/i,
    /\bsudo\b/i,
    /\bchmod\s+777/i,
    /\bshutdown\b/i,
    /\breboot\b/i,
    /\bmkfs\b/i,
    /\bdd\s+if=/i,
    />\s*\/dev\/sd/i,
    /:(){ :|:& };:/, // fork bomb
  ];

  // Commands requiring explicit human approval
  private static APPROVAL_REQUIRED_PATTERNS = [
    /\bgit\s+push\b/i,
    /\bnpm\s+publish\b/i,
    /\bdeploy\b/i,
    /\bdrop\s+database\b/i,
    /\btruncate\b/i,
    /\bdelete\s+from\b/i,
    /\brm\s+/i,
  ];

  public static evaluateProposal(proposal: ToolProposal): PolicyCheckResult {
    switch (proposal.action) {
      case 'read_file':
      case 'list_files':
      case 'create_checkpoint':
        return {
          allowed: true,
          requiresUserApproval: false,
          riskLevel: 'low',
          reason: 'Read-only operation within workspace boundary.',
        };

      case 'write_file':
        // Path traversal protection
        if (proposal.params.path?.includes('..') || proposal.params.path?.startsWith('/etc') || proposal.params.path?.startsWith('/root')) {
          return {
            allowed: false,
            requiresUserApproval: false,
            riskLevel: 'critical',
            reason: 'Path traversal attempt outside workspace.',
          };
        }
        return {
          allowed: true,
          requiresUserApproval: false,
          riskLevel: 'medium',
          reason: 'File modification within designated project workspace.',
        };

      case 'execute_command': {
        const cmd = proposal.params.command || '';

        // 1. Check prohibited dangerous patterns
        for (const pattern of this.DANGEROUS_PATTERNS) {
          if (pattern.test(cmd)) {
            return {
              allowed: false,
              requiresUserApproval: false,
              riskLevel: 'critical',
              reason: `Command matches strictly prohibited security pattern: ${pattern}.`,
            };
          }
        }

        // 2. Check approval required patterns
        for (const pattern of this.APPROVAL_REQUIRED_PATTERNS) {
          if (pattern.test(cmd)) {
            return {
              allowed: true,
              requiresUserApproval: true,
              riskLevel: 'high',
              reason: 'Command has high-impact side effects and requires explicit user consent.',
            };
          }
        }

        return {
          allowed: true,
          requiresUserApproval: false,
          riskLevel: 'medium',
          reason: 'Command authorized within local execution boundary.',
        };
      }

      case 'run_tests':
        return {
          allowed: true,
          requiresUserApproval: false,
          riskLevel: 'low',
          reason: 'Automated test suite execution.',
        };

      default:
        return {
          allowed: false,
          requiresUserApproval: false,
          riskLevel: 'high',
          reason: `Unknown action: ${(proposal as any).action}`,
        };
    }
  }
}
