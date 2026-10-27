import { NextRequest, NextResponse } from 'next/server';
import { AgentWorkspace } from '@/lib/agent/workspace';
import { AgentExecutor } from '@/lib/agent/executor';
import { ToolProposal } from '@/types/agent';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { workspaceId = 'default_workspace', proposal, approvedByUser = false } = body;

    if (!proposal || !proposal.action) {
      return NextResponse.json({ success: false, error: 'Tool proposal is required.' }, { status: 400 });
    }

    const workspace = new AgentWorkspace(workspaceId);
    const result = await AgentExecutor.executeTool(workspace, proposal as ToolProposal, approvedByUser);

    return NextResponse.json({
      success: result.success,
      data: result,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const workspaceId = searchParams.get('workspaceId') || 'default_workspace';

    const workspace = new AgentWorkspace(workspaceId);
    const files = workspace.listFiles();
    const checkpoints = workspace.getCheckpoints();

    return NextResponse.json({
      success: true,
      data: {
        workspaceId,
        files,
        checkpoints,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
