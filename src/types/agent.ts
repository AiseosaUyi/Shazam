export interface WorkspaceFile {
  path: string;
  sizeBytes: number;
  lastModified: string;
  isBinary: boolean;
}

export type ToolActionType =
  | 'read_file'
  | 'write_file'
  | 'list_files'
  | 'execute_command'
  | 'run_tests'
  | 'create_checkpoint';

export interface ToolProposal {
  id: string;
  action: ToolActionType;
  params: {
    path?: string;
    content?: string;
    command?: string;
    testSuite?: string;
    checkpointDescription?: string;
  };
  rationale: string;
}

export interface PolicyCheckResult {
  allowed: boolean;
  requiresUserApproval: boolean;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  reason: string;
}

export interface Checkpoint {
  id: string;
  description: string;
  createdAt: string;
  files: Record<string, string>; // path -> content snapshot
}

export interface AgentExecutionState {
  workspaceId: string;
  currentStep: number;
  maxSteps: number;
  status: 'idle' | 'planning' | 'executing' | 'waiting_for_approval' | 'completed' | 'failed';
  pendingProposal?: ToolProposal;
  checkpoints: Checkpoint[];
  diffs: Array<{ path: string; oldContent?: string; newContent: string }>;
  logs: Array<{ timestamp: string; level: 'info' | 'warn' | 'error'; message: string }>;
}
