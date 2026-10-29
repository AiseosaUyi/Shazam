import { NextResponse } from 'next/server';
import { detectLocalHardware } from '@/lib/hardware/detector';
import { checkOllamaLiveness } from '@/lib/execution/adapters/ollama';

export async function GET() {
  const hardware = detectLocalHardware();
  const ollama = await checkOllamaLiveness();

  return NextResponse.json({
    hardware,
    ollama: {
      active: ollama.active,
      installedModels: ollama.models,
      url: process.env.OLLAMA_HOST || 'http://127.0.0.1:11434',
    },
    timestamp: new Date().toISOString(),
  });
}
