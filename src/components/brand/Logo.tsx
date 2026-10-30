import React, { useId } from 'react';

/**
 * Shazam mark: a geometric bolt cut from a graphite tile, lit in Volt → Ion.
 * The bolt's two strokes are offset on a 4px grid so it stays crisp at 16px.
 */
export function LogoMark({ size = 28, className = '' }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`g${id}`} x1="8" y1="4" x2="24" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="rgb(var(--brand))" />
          <stop offset="1" stopColor="rgb(var(--ion))" />
        </linearGradient>
      </defs>
      <rect x="0.5" y="0.5" width="31" height="31" rx="9" fill="rgb(var(--surface))" stroke="rgb(var(--line) / 0.12)" />
      <path d="M18.6 5 9 17.4h6.3L13.4 27 23 14.6h-6.3L18.6 5Z" fill={`url(#g${id})`} />
    </svg>
  );
}

export function Logo({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark size={size} />
      <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Shazam</span>
    </span>
  );
}
