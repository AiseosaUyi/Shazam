const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { execSync } = require('child_process');

const svgContent = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- Background Gradient -->
    <linearGradient id="bgGrad" x1="0" y1="0" x2="1024" y2="1024" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#181a20" />
      <stop offset="50%" stop-color="#0c0d12" />
      <stop offset="100%" stop-color="#050608" />
    </linearGradient>

    <!-- Border Gradient -->
    <linearGradient id="borderGrad" x1="0" y1="0" x2="1024" y2="1024" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#f59e0b" stop-opacity="0.8" />
      <stop offset="40%" stop-color="#fbbf24" stop-opacity="0.3" />
      <stop offset="100%" stop-color="#d97706" stop-opacity="0.8" />
    </linearGradient>

    <!-- Lightning Bolt Gradient -->
    <linearGradient id="boltGrad" x1="512" y1="180" x2="512" y2="850" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#ffffff" />
      <stop offset="25%" stop-color="#fef08a" />
      <stop offset="60%" stop-color="#f59e0b" />
      <stop offset="100%" stop-color="#d97706" />
    </linearGradient>

    <!-- Glow Filter -->
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="35" result="blur" />
      <feMerge>
        <feMergeNode in="blur" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
  </defs>

  <!-- Squircle Base with Shadow -->
  <rect x="72" y="72" width="880" height="880" rx="200" fill="url(#bgGrad)" />
  <rect x="72" y="72" width="880" height="880" rx="200" stroke="url(#borderGrad)" stroke-width="14" />

  <!-- Inner subtle ambient glow -->
  <circle cx="512" cy="480" r="280" fill="#f59e0b" opacity="0.12" filter="blur(60px)" />

  <!-- Luminous Shazam Lightning Bolt -->
  <path d="M570 160L290 530H480L420 864L734 450H530L570 160Z" 
        fill="url(#boltGrad)" 
        filter="url(#glow)" 
        stroke="#ffffff" 
        stroke-width="8" 
        stroke-linejoin="round" />

  <!-- Bolt Inner Core Highlight -->
  <path d="M565 190L320 520H475L425 810L685 460H515L565 190Z" 
        fill="#ffffff" 
        opacity="0.4" 
        stroke-linejoin="round" />
</svg>`;

async function buildIcons() {
  const desktopDir = path.join(__dirname, '..', 'desktop');
  if (!fs.existsSync(desktopDir)) fs.mkdirSync(desktopDir, { recursive: true });

  const svgPath = path.join(desktopDir, 'icon.svg');
  fs.writeFileSync(svgPath, svgContent);

  const png1024Path = path.join(desktopDir, 'icon.png');
  await sharp(Buffer.from(svgContent)).resize(1024, 1024).png().toFile(png1024Path);
  console.log('✓ Created 1024x1024 icon.png');

  // Build .iconset for macOS iconutil
  const iconsetDir = path.join(desktopDir, 'icon.iconset');
  if (fs.existsSync(iconsetDir)) fs.rmSync(iconsetDir, { recursive: true, force: true });
  fs.mkdirSync(iconsetDir);

  const sizes = [16, 32, 64, 128, 256, 512];
  for (const size of sizes) {
    await sharp(png1024Path).resize(size, size).png().toFile(path.join(iconsetDir, `icon_${size}x${size}.png`));
    await sharp(png1024Path).resize(size * 2, size * 2).png().toFile(path.join(iconsetDir, `icon_${size}x${size}@2x.png`));
  }
  await sharp(png1024Path).resize(1024, 1024).png().toFile(path.join(iconsetDir, 'icon_512x512@2x.png'));

  const icnsPath = path.join(desktopDir, 'icon.icns');
  try {
    execSync(`iconutil -c icns "${iconsetDir}" -o "${icnsPath}"`);
    console.log('✓ Successfully generated native macOS desktop/icon.icns');
    fs.rmSync(iconsetDir, { recursive: true, force: true });
  } catch (err) {
    console.warn('iconutil skipped or failed:', err.message);
  }
}

buildIcons().catch(console.error);
