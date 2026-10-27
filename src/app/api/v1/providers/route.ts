import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {
    const userId = 'user_default'; // default user session in MVP
    const providers = await db.getProviders();
    const userCredentials = await db.getCredentialsForUser(userId);

    const credMap = new Map(userCredentials.map((c) => [c.providerId, c]));

    const systemKeysAvailable: Record<string, boolean> = {
      google: Boolean(process.env.GOOGLE_AI_API_KEY),
      deepseek: Boolean(process.env.DEEPSEEK_API_KEY),
      openrouter: Boolean(process.env.OPENROUTER_API_KEY),
      openai: Boolean(process.env.OPENAI_API_KEY),
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      alibaba: Boolean(process.env.DASHSCOPE_API_KEY),
      simulation: true,
    };

    const result = providers.map((p) => {
      const cred = credMap.get(p.id);
      return {
        ...p,
        isConnected: Boolean(cred) || systemKeysAvailable[p.id] === true,
        keyPrefix: cred ? cred.keyPrefix : systemKeysAvailable[p.id] ? 'system_configured' : undefined,
        credentialStatus: cred ? cred.status : systemKeysAvailable[p.id] ? 'valid' : 'unconnected',
        lastValidatedAt: cred?.lastValidatedAt,
      };
    });

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
