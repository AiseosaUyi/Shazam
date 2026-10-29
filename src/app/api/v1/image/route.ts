import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const prompt = searchParams.get('prompt') || '';
  const seed = searchParams.get('seed') || Math.floor(Math.random() * 1000000).toString();

  if (!prompt.trim()) {
    return new NextResponse('Prompt is required', { status: 400 });
  }

  // Clean prompt and remove enclosing quotes
  let cleanPrompt = prompt.replace(/^["'`]+|["'`]+$/g, '').trim();

  // If prompt depicts people/portraits, enhance details for natural anatomy, facial fidelity and skin texture
  const isHumanSubject = /\b(girl|woman|man|boy|person|portrait|human|face|people|rider|lady|guy|model|pedestrian)\b/i.test(cleanPrompt);
  if (isHumanSubject && !cleanPrompt.toLowerCase().includes('photorealistic')) {
    cleanPrompt = `${cleanPrompt}, 8k resolution, photorealistic, natural skin texture, sharp detailed eyes and facial features, realistic proportions, cinematic lighting, 35mm photograph`;
  }

  const encoded = encodeURIComponent(cleanPrompt);

  // Redirect directly to high-fidelity FLUX generator with seed and enhancement
  const targetUrl = `https://image.pollinations.ai/prompt/${encoded}?model=flux&width=1024&height=1024&nologo=true&enhance=false&seed=${seed}`;

  return NextResponse.redirect(targetUrl, 307);
}
