import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/lib/db';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: providerId } = await params;
    const body = await req.json();
    const { status } = body;

    if (!['enabled', 'degraded', 'disabled'].includes(status)) {
      return NextResponse.json(
        { success: false, error: 'Status must be enabled, degraded, or disabled.' },
        { status: 400 }
      );
    }

    const updated = await db.updateProviderStatus(providerId, status);
    if (!updated) {
      return NextResponse.json({ success: false, error: 'Provider not found.' }, { status: 404 });
    }

    // Record audit event
    await db.recordAuditEvent({
      id: `audit_${crypto.randomUUID()}`,
      actorId: 'admin_user',
      action: 'admin_update_provider_status',
      targetType: 'provider',
      targetId: providerId,
      timestamp: new Date().toISOString(),
      outcome: 'success',
      metadata: { status },
    });

    return NextResponse.json({
      success: true,
      data: updated,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
