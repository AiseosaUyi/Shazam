import React from 'react';
import Link from 'next/link';
import { Logo } from '@/components/brand/Logo';
import { BRAND_NAME } from '@/lib/brand';

/** Minimal frame for public pages (privacy, terms, early access): logo, content, footer links. */
export function PublicShell({ children, width = 'max-w-2xl' }: { children: React.ReactNode; width?: string }) {
  return (
    <div className="shz-atmosphere flex min-h-0 flex-1 flex-col overflow-y-auto">
      <header className="flex items-center justify-between px-4 py-4 sm:px-6">
        <Link href="/" aria-label={`${BRAND_NAME} home`}>
          <Logo size={26} />
        </Link>
        <Link href="/login" className="rounded-lg px-3 py-1.5 text-[13px] text-ink-2 hover:bg-surface-2 hover:text-ink">
          Sign in
        </Link>
      </header>
      <div className={`mx-auto w-full flex-1 px-4 pb-16 pt-6 sm:px-6 ${width}`}>{children}</div>
      <LegalFooter />
    </div>
  );
}

export function LegalFooter({ className = '' }: { className?: string }) {
  return (
    <footer className={`flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 py-6 text-[12px] text-ink-3 ${className}`}>
      <Link href="/privacy" className="hover:text-ink-2">Privacy</Link>
      <Link href="/terms" className="hover:text-ink-2">Terms</Link>
      <Link href="/waitlist" className="hover:text-ink-2">Early access</Link>
    </footer>
  );
}

/** Long-form legal text styling without a typography plugin. */
export function LegalDoc({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <article className="text-[14px] leading-relaxed text-ink-2 [&_a]:text-ink [&_a]:underline [&_a]:underline-offset-2 [&_h2]:mb-2 [&_h2]:mt-9 [&_h2]:text-[16px] [&_h2]:font-semibold [&_h2]:text-ink [&_li]:mt-1.5 [&_p]:mt-3 [&_strong]:text-ink [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5">
      <h1 className="text-[28px] font-semibold tracking-[-0.025em] text-ink">{title}</h1>
      <p className="shz-mono !mt-2 text-[12px] text-ink-3">Effective {updated}</p>
      {children}
    </article>
  );
}
