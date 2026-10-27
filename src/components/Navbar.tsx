'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Zap,
  MessageSquare,
  Cpu,
  KeyRound,
  BarChart3,
  Sliders,
  ShieldAlert,
  Code2,
  Menu,
  X,
  LogOut,
  ChevronDown,
  Plus,
  Sparkles,
} from 'lucide-react';

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [user, setUser] = useState<{ email: string; role: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const pathname = usePathname();
  const router = useRouter();
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/v1/auth/me')
      .then((res) => (res.ok ? res.json() : { user: null }))
      .then((data) => {
        setUser(data.user);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [pathname]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function handleLogout() {
    await fetch('/api/v1/auth/logout', { method: 'POST' });
    setUser(null);
    router.push('/login');
  }

  const primaryTabs = [
    { href: '/', label: 'Workspace', icon: MessageSquare },
    { href: '/agent', label: 'Coding Studio', icon: Code2 },
    { href: '/models', label: 'Models', icon: Cpu },
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-[#08090c]/80 backdrop-blur-xl px-4 sm:px-6 py-2.5">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        {/* Brand & Primary Navigation */}
        <div className="flex items-center gap-8">
          <Link
            href="/"
            className="flex items-center gap-2.5 group focus:outline-none"
          >
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-500 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/20 group-hover:scale-105 transition-transform duration-200">
              <Zap className="w-4 h-4 text-zinc-950 fill-zinc-950 stroke-[2.5]" />
            </div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-base tracking-tight text-white font-sans">
                Shazam
              </span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20 tracking-wider uppercase font-mono">
                AI
              </span>
            </div>
          </Link>

          {/* Primary View Switcher */}
          <nav className="hidden md:flex items-center gap-1 p-1 bg-white/[0.03] border border-white/[0.06] rounded-xl text-xs">
            {primaryTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = pathname === tab.href;
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={`px-3 py-1.5 rounded-lg transition-all duration-200 flex items-center gap-1.5 font-medium ${
                    isActive
                      ? 'bg-white/[0.08] text-white shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-amber-400' : 'text-zinc-500'}`} />
                  <span>{tab.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Right Side: Quick Action + Profile Dropdown */}
        <div className="flex items-center gap-3">
          {pathname === '/' && (
            <Link
              href="/"
              onClick={() => {
                window.location.href = '/';
              }}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-medium transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Chat</span>
            </Link>
          )}

          {loading ? null : user ? (
            <div className="relative" ref={userMenuRef}>
              <button
                type="button"
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="flex items-center gap-2 p-1.5 pr-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] transition text-xs text-zinc-300 focus:outline-none"
              >
                <div className="w-6 h-6 rounded-lg bg-gradient-to-tr from-amber-500/20 to-orange-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 font-semibold text-xs">
                  {user.email.charAt(0).toUpperCase()}
                </div>
                <span className="max-w-[120px] truncate text-zinc-300 font-medium hidden sm:inline">
                  {user.email.split('@')[0]}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
              </button>

              {/* Glass Dropdown Menu */}
              {userMenuOpen && (
                <div className="absolute right-0 mt-2 w-56 rounded-2xl bg-[#0f1117]/95 border border-white/[0.08] shadow-2xl backdrop-blur-2xl py-2 z-50 text-xs text-zinc-300 animate-in fade-in zoom-in-95 duration-150">
                  <div className="px-3 py-2 border-b border-white/[0.06] mb-1">
                    <p className="text-[11px] text-zinc-500">Signed in as</p>
                    <p className="font-medium text-white truncate mt-0.5">{user.email}</p>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="text-[10px] text-emerald-400 font-medium">Free Tier Active</span>
                    </div>
                  </div>

                  <Link
                    href="/connections"
                    onClick={() => setUserMenuOpen(false)}
                    className="flex items-center gap-2.5 px-3 py-2 hover:bg-white/[0.06] hover:text-white transition"
                  >
                    <KeyRound className="w-4 h-4 text-amber-400" />
                    <span>AI Provider Keys (Free & BYOK)</span>
                  </Link>

                  <Link
                    href="/usage"
                    onClick={() => setUserMenuOpen(false)}
                    className="flex items-center gap-2.5 px-3 py-2 hover:bg-white/[0.06] hover:text-white transition"
                  >
                    <BarChart3 className="w-4 h-4 text-blue-400" />
                    <span>Usage & Budget Ledger</span>
                  </Link>

                  <Link
                    href="/settings"
                    onClick={() => setUserMenuOpen(false)}
                    className="flex items-center gap-2.5 px-3 py-2 hover:bg-white/[0.06] hover:text-white transition"
                  >
                    <Sliders className="w-4 h-4 text-purple-400" />
                    <span>Routing & Privacy Settings</span>
                  </Link>

                  {user.role === 'admin' && (
                    <Link
                      href="/admin"
                      onClick={() => setUserMenuOpen(false)}
                      className="flex items-center gap-2.5 px-3 py-2 hover:bg-white/[0.06] hover:text-white transition text-amber-300"
                    >
                      <ShieldAlert className="w-4 h-4 text-amber-400" />
                      <span>Admin Kill Switches</span>
                    </Link>
                  )}

                  <div className="border-t border-white/[0.06] my-1" />

                  <button
                    type="button"
                    onClick={handleLogout}
                    className="w-full text-left flex items-center gap-2.5 px-3 py-2 hover:bg-red-500/10 text-red-400 transition"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Sign Out</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs">
              <Link
                href="/login"
                className="px-3 py-1.5 rounded-lg text-zinc-300 hover:text-white hover:bg-white/[0.04] transition"
              >
                Sign In
              </Link>
              <Link
                href="/signup"
                className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold transition shadow-sm"
              >
                Get Started
              </Link>
            </div>
          )}

          {/* Mobile Menu Button */}
          <button
            type="button"
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.04] transition"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="md:hidden pt-3 pb-2 border-t border-white/[0.06] mt-2.5 space-y-1 animate-in fade-in duration-150">
          {primaryTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium ${
                  isActive ? 'bg-white/[0.08] text-white' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </Link>
            );
          })}
          <div className="border-t border-white/[0.06] my-2" />
          <Link
            href="/connections"
            onClick={() => setMobileOpen(false)}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-zinc-400 hover:text-zinc-200"
          >
            <KeyRound className="w-4 h-4 text-amber-400" />
            <span>AI Connections (Free & BYOK)</span>
          </Link>
          <Link
            href="/usage"
            onClick={() => setMobileOpen(false)}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-zinc-400 hover:text-zinc-200"
          >
            <BarChart3 className="w-4 h-4 text-blue-400" />
            <span>Usage & Ledger</span>
          </Link>
          <Link
            href="/settings"
            onClick={() => setMobileOpen(false)}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-zinc-400 hover:text-zinc-200"
          >
            <Sliders className="w-4 h-4 text-purple-400" />
            <span>Settings</span>
          </Link>
        </div>
      )}
    </header>
  );
}
