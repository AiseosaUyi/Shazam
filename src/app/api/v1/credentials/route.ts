import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/lib/db';
import { encryptSecret, maskApiKey } from '@/lib/crypto/vault';
import { providerRegistry } from '@/lib/providers/registry';

export async function POST(req: NextRequest) {
  try {
    const userId = 'user_default';
    const body = await req.json();
    const { providerId, apiKey } = body;

    if (!providerId || !apiKey) {
      return NextResponse.json(
        { success: false, error: 'Both providerId and apiKey are required.' },
        { status: 400 }
      );
    }

    const provider = await db.getProviderById(providerId);
    if (!provider) {
      return NextResponse.json({ success: false, error: 'Provider not found.' }, { status: 404 });
    }

    // Validate key with provider adapter
    let validationResult: { valid: boolean; error?: string } = { valid: true };
    if (providerRegistry.hasAdapter(providerId)) {
      const adapter = providerRegistry.getAdapter(providerId);
      validationResult = await adapter.validateCredentials(apiKey);
    }

    if (!validationResult.valid) {
      return NextResponse.json(
        { success: false, error: validationResult.error || 'Invalid API key.' },
        { status: 400 }
      );
    }

    // Encrypt secret with AES-256-GCM
    const encryptedKey = encryptSecret(apiKey);
    const keyPrefix = maskApiKey(apiKey);

    const cred = await db.saveCredential({
      id: `${userId}:${providerId}`,
      userId,
      providerId,
      encryptedKey,
      keyPrefix,
      keyVersion: 1,
      status: 'valid',
      createdAt: new Date().toISOString(),
      lastValidatedAt: new Date().toISOString(),
    });

    // Record audit event
    await db.recordAuditEvent({
      id: `audit_${crypto.randomUUID()}`,
      actorId: userId,
      action: 'connect_provider_key',
      targetType: 'provider',
      targetId: providerId,
      timestamp: new Date().toISOString(),
      outcome: 'success',
      metadata: { keyPrefix },
    });

    // Return safe object WITHOUT plaintext key
    return NextResponse.json({
      success: true,
      data: {
        id: cred.id,
        providerId: cred.providerId,
        keyPrefix: cred.keyPrefix,
        status: cred.status,
        lastValidatedAt: cred.lastValidatedAt,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
