import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const prompt = searchParams.get('prompt') || '';
  const seed = searchParams.get('seed') || Math.floor(Math.random() * 1000000).toString();
  const width = searchParams.get('width') || '1024';
  const height = searchParams.get('height') || '1024';

  if (!prompt.trim()) {
    return new NextResponse('Prompt is required', { status: 400 });
  }

  // Clean prompt and remove enclosing quotes
  let cleanPrompt = prompt.replace(/^["'`]+|["'`]+$/g, '').trim();

  // If prompt depicts people/portraits, enhance details for natural anatomy, facial fidelity and skin texture
  const isHumanSubject = /\b(girl|woman|man|boy|person|portrait|human|face|people|rider|lady|guy|model|pedestrian|bicycle)\b/i.test(cleanPrompt);
  if (isHumanSubject && !cleanPrompt.toLowerCase().includes('photorealistic')) {
    cleanPrompt = `${cleanPrompt}, 8k resolution, photorealistic, natural skin texture, sharp detailed eyes and facial features, realistic proportions, cinematic lighting, 35mm photograph`;
  }

  const encoded = encodeURIComponent(cleanPrompt);
  const targetUrl = `https://image.pollinations.ai/prompt/${encoded}?model=flux&width=${width}&height=${height}&nologo=true&enhance=false&seed=${seed}`;

  try {
    const upstreamRes = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Shazam-AI-Gateway/1.0',
        'Accept': 'image/jpeg, image/png, image/*',
      },
    });

    if (upstreamRes.ok) {
      const contentType = upstreamRes.headers.get('content-type') || 'image/jpeg';
      const imageBytes = await upstreamRes.arrayBuffer();

      return new NextResponse(imageBytes, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=604800, immutable',
          'X-Provider-Attribution': 'Pollinations AI (FLUX.1 Schnell)',
          'X-Quality-Enhancement': isHumanSubject ? 'applied' : 'none',
        },
      });
    }
  } catch {
    // If proxy fetch fails, fallback to 307 redirect
  }

  return NextResponse.redirect(targetUrl, 307);
}
