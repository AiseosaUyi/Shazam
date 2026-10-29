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

  // Primary URL: FLUX.1 Schnell
  const targetUrl = `https://image.pollinations.ai/prompt/${encoded}?model=flux&width=1024&height=1024&nologo=true&seed=${seed}`;

  try {
    let upstreamRes = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)',
        'Accept': 'image/jpeg,image/png,image/*,*/*',
      },
    });

    // Fallback attempt with turbo model if FLUX is rate-limited or busy
    if (!upstreamRes.ok || !upstreamRes.headers.get('content-type')?.startsWith('image/')) {
      const fallbackUrl = `https://image.pollinations.ai/prompt/${encoded}?model=turbo&nologo=true&seed=${seed}`;
      const fallbackRes = await fetch(fallbackUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)',
          'Accept': 'image/jpeg,image/png,image/*,*/*',
        },
      });
      if (fallbackRes.ok && fallbackRes.headers.get('content-type')?.startsWith('image/')) {
        upstreamRes = fallbackRes;
      }
    }

    if (upstreamRes.ok && upstreamRes.headers.get('content-type')?.startsWith('image/')) {
      const imageBuffer = await upstreamRes.arrayBuffer();
      const contentType = upstreamRes.headers.get('content-type') || 'image/jpeg';

      return new NextResponse(imageBuffer, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=604800, s-maxage=604800, immutable',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Upstream community GPU queue busy - render informative high-res SVG canvas
    const escapedText = cleanPrompt
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#090d16"/>
      <stop offset="50%" stop-color="#141828"/>
      <stop offset="100%" stop-color="#070a10"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ec4899" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>
  <circle cx="512" cy="512" r="400" fill="url(#glow)"/>
  <text x="512" y="440" font-family="system-ui, -apple-system, sans-serif" font-size="30" font-weight="700" fill="#f472b6" text-anchor="middle">🎨 FLUX.1 Schnell Generator</text>
  <text x="512" y="490" font-family="system-ui, -apple-system, sans-serif" font-size="18" fill="#cbd5e1" text-anchor="middle">Free Community GPU Pool is warming up or rate-limited (1 req / 45s per IP).</text>
  <text x="512" y="530" font-family="system-ui, -apple-system, sans-serif" font-size="16" fill="#94a3b8" text-anchor="middle">Click "Retry Rendering" in a few seconds to load the generated frame.</text>
  <rect x="112" y="580" width="800" height="70" rx="14" fill="#ffffff" fill-opacity="0.04" stroke="#ffffff" stroke-opacity="0.1"/>
  <text x="512" y="622" font-family="monospace" font-size="14" fill="#fbbf24" text-anchor="middle">"${escapedText.slice(0, 65)}${escapedText.length > 65 ? '...' : ''}"</text>
</svg>`;

    return new NextResponse(svg, {
      status: 200,
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err: any) {
    return new NextResponse('Internal image rendering error', { status: 500 });
  }
}
