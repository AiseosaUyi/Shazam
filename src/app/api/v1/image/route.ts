import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const prompt = searchParams.get('prompt') || '';
  const seed = searchParams.get('seed') || Math.floor(Math.random() * 1000000).toString();

  if (!prompt.trim()) {
    return new NextResponse('Prompt is required', { status: 400 });
  }

  // Clean prompt and remove enclosing quotes
  const cleanPrompt = prompt.replace(/^["'`]+|["'`]+$/g, '').trim();
  const encoded = encodeURIComponent(cleanPrompt);

  // Redirect directly to high-fidelity generator with prompt enhancement for photorealistic quality
  const targetUrl = `https://image.pollinations.ai/prompt/${encoded}?model=flux&width=1024&height=1024&nologo=true&enhance=true&seed=${seed}`;

  return NextResponse.redirect(targetUrl, 307);
}
