import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/lib/db';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = 'user_default';
    const { id: providerId } = await params;

    const deleted = await db.deleteCredential(userId, providerId);

    await db.recordAuditEvent({
      id: `audit_${crypto.randomUUID()}`,
      actorId: userId,
      action: 'revoke_provider_key',
      targetType: 'provider',
      targetId: providerId,
      timestamp: new Date().toISOString(),
      outcome: deleted ? 'success' : 'failure',
    });

    return NextResponse.json({
      success: true,
      data: { revoked: deleted },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
