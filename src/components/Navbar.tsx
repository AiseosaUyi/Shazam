'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { MessageSquare, Zap, Code2, Plug, Sparkles, Cpu, BarChart3, Settings, ShieldAlert, LogOut, Menu, X, ArrowLeft } from 'lucide-react';
import { Logo } from '@/components/brand/Logo';

/**
 * App shell top bar. The logo sits over the sidebar column (same width and inset as the
 * sidebar items), the mode switcher starts where page content starts, and the account
 * menu sits at the far right, like Claude Desktop.
 */

const MODES = [
  { href: '/', label: 'Chat', icon: MessageSquare, match: (p: string) => p === '/' },
  { href: '/cowork', label: 'Co-Work', icon: Zap, match: (p: string) => p.startsWith('/cowork') },
  { href: '/agent', label: 'Code', icon: Code2, match: (p: string) => p.startsWith('/agent') },
];

const MENU = [
  { href: '/connections', label: 'Connections', hint: 'Keys, Google, devices, assistants', icon: Plug },
  { href: '/settings?tab=skills', label: 'Skills', hint: 'Reusable instructions', icon: Sparkles },
  { href: '/models', label: 'Models', hint: 'Free and connected models', icon: Cpu },
  { href: '/usage', label: 'Usage', hint: 'Activity and spend', icon: BarChart3 },
  { href: '/settings', label: 'Settings', hint: 'Preferences and MCP servers', icon: Settings },
];

const HIDE_ON = ['/login', '/signup', '/oauth'];

/** Account pages show "Back to <mode>" instead of the mode switcher. */
const ACCOUNT_PAGES: Array<{ prefix: string; title: string }> = [
  { prefix: '/connections', title: 'Connections' },
  { prefix: '/settings', title: 'Settings' },
  { prefix: '/usage', title: 'Usage' },
  { prefix: '/admin', title: 'Admin' },
  { prefix: '/runs', title: 'Task' },
  { prefix: '/onboarding', title: 'Welcome' },
];

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [user, setUser] = useState<{ email: string; role: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const pathname = usePathname() || '/';
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement>(null);
  const [lastMode, setLastMode] = useState<{ href: string; label: string }>({ href: '/', label: 'Chat' });
  const accountPage = ACCOUNT_PAGES.find((p) => pathname.startsWith(p.prefix));

  useEffect(() => {
    const mode = MODES.find((m) => m.match(pathname));
    try {
      if (mode) sessionStorage.setItem('shz_last_mode', JSON.stringify({ href: mode.href, label: mode.label }));
      else {
        const saved = sessionStorage.getItem('shz_last_mode');
        if (saved) setLastMode(JSON.parse(saved));
      }
    } catch {
      // storage unavailable
    }
  }, [pathname]);

  useEffect(() => {
    fetch('/api/v1/auth/me')
      .then((res) => (res.ok ? res.json() : { user: null }))
      .then((data) => setUser(data.user))
      .catch(() => {})
      .finally(() => setLoading(false));
    setMobileOpen(false);
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  async function signOut() {
    await fetch('/api/v1/auth/logout', { method: 'POST' });
    setUser(null);
    router.push('/login');
  }

  if (HIDE_ON.some((p) => pathname.startsWith(p))) return null;
  const initial = user?.email.charAt(0).toUpperCase() || '?';

  return (
    <header className="relative z-50 flex h-12 shrink-0 items-center border-b border-line/[0.06] bg-sidebar">
      {/* Brand column: same width and inset as the page sidebars (w-64, px-3) */}
      <div className="flex h-full items-center px-4 md:w-64 md:shrink-0 md:px-3">
        <Link href="/" aria-label="Shazam home" className="rounded-lg px-1.5 py-1 hover:bg-surface-2/60">
          <Logo size={24} />
        </Link>
      </div>

      {accountPage && (
        <div className="flex min-w-0 items-center gap-3 md:ml-4">
          <Link href={lastMode.href} className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] text-ink-2 hover:bg-surface-2 hover:text-ink">
            <ArrowLeft className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Back to {lastMode.label}</span>
          </Link>
          <span className="truncate text-[13px] font-medium text-ink">{accountPage.title}</span>
        </div>
      )}

      {/* Mode switcher (workspaces only) */}
      <nav aria-label="Mode" className={`hidden items-center gap-0.5 rounded-xl border border-line/[0.06] bg-canvas/60 p-0.5 md:ml-4 ${accountPage ? '' : 'md:flex'}`}>
        {MODES.map(({ href, label, icon: Icon, match }) => {
          const active = match(pathname);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-[13px] font-medium transition ${active ? 'bg-surface-2 text-ink shadow-sm' : 'text-ink-3 hover:text-ink'}`}
            >
              <Icon className={`h-3.5 w-3.5 ${active ? 'text-brand' : ''}`} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="ml-auto flex items-center gap-2 px-3">
        {loading ? null : user ? (
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 text-[13px] font-semibold text-ink ring-1 ring-line/10 transition hover:ring-brand/40"
              title={user.email}
            >
              {initial}
            </button>
            {menuOpen && (
              <div role="menu" className="absolute right-0 mt-2 w-72 origin-top-right rounded-2xl border border-line/10 bg-surface p-1.5 shadow-2xl animate-shz-in">
                <div className="flex items-center gap-3 px-2.5 py-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-sm font-semibold text-ink">{initial}</div>
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-ink">{user.email}</p>
                    <p className="text-[11px] text-ink-3">{user.role === 'admin' ? 'Admin' : 'Free plan'}</p>
                  </div>
                </div>
                <div className="my-1 h-px bg-line/[0.06]" />
                {MENU.map(({ href, label, hint, icon: Icon }) => (
                  <Link key={href} href={href} role="menuitem" className="flex items-center gap-3 rounded-xl px-2.5 py-2 text-ink-2 transition hover:bg-surface-2 hover:text-ink">
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-[13px] text-ink">{label}</span>
                      <span className="block truncate text-[11px] text-ink-3">{hint}</span>
                    </span>
                  </Link>
                ))}
                {user.role === 'admin' && (
                  <Link href="/admin" role="menuitem" className="flex items-center gap-3 rounded-xl px-2.5 py-2 text-[13px] text-ink-2 transition hover:bg-surface-2 hover:text-ink">
                    <ShieldAlert className="h-4 w-4" /> Admin
                  </Link>
                )}
                <div className="my-1 h-px bg-line/[0.06]" />
                <button onClick={signOut} role="menuitem" className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-[13px] text-ink-2 transition hover:bg-surface-2 hover:text-ink">
                  <LogOut className="h-4 w-4" /> Sign out
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            <Link href="/login" className="rounded-xl px-3 py-1.5 text-[13px] text-ink-2 hover:text-ink">Sign in</Link>
            <Link href="/signup" className="rounded-xl bg-brand px-3 py-1.5 text-[13px] font-semibold text-brand-ink hover:bg-brand-soft">Get started</Link>
          </>
        )}
        <button className={`rounded-lg p-1.5 text-ink-2 hover:bg-surface-2 md:hidden ${accountPage ? 'hidden' : ''}`} onClick={() => setMobileOpen((v) => !v)} aria-label="Menu">
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {mobileOpen && !accountPage && (
        <div className="absolute inset-x-0 top-12 border-b border-line/[0.06] bg-sidebar p-3 md:hidden animate-shz-in">
          <div className="grid grid-cols-3 gap-1.5">
            {MODES.map(({ href, label, icon: Icon, match }) => (
              <Link key={href} href={href} className={`flex flex-col items-center gap-1 rounded-xl py-2.5 text-[12px] ${match(pathname) ? 'bg-surface-2 text-ink' : 'text-ink-2'}`}>
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
