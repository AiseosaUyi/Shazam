import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { TaskOrchestrator } from '@/lib/task/orchestrator';

export async function POST(req: NextRequest) {
  try {
    const userId = 'user_default';
    const body = await req.json();
    const { prompt, conversationId, attachments, costPolicy, pinnedRouteId } = body;

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return NextResponse.json({ success: false, error: 'Prompt is required.' }, { status: 400 });
    }

    // Launch task execution
    const task = await TaskOrchestrator.executeTask({
      userId,
      prompt: prompt.trim(),
      conversationId,
      attachments,
      costPolicy,
      pinnedRouteId,
    });

    return NextResponse.json({
      success: true,
      data: task,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const userId = 'user_default';
    const tasks = await db.listTasksForUser(userId);
    return NextResponse.json({
      success: true,
      data: tasks,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
