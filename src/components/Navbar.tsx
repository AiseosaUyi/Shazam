'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Zap,
  Compass,
  Cpu,
  KeyRound,
  BarChart3,
  Sliders,
  ShieldAlert,
  Code2,
  Menu,
  X,
  LogOut,
  User as UserIcon,
} from 'lucide-react';

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [user, setUser] = useState<{ email: string; role: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    fetch('/api/v1/auth/me')
      .then((res) => (res.ok ? res.json() : { user: null }))
      .then((data) => {
        setUser(data.user);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [pathname]);

  async function handleLogout() {
    await fetch('/api/v1/auth/logout', { method: 'POST' });
    setUser(null);
    router.push('/login');
  }

  const navLinks = [
    { href: '/', label: 'Workspace', icon: Compass },
    { href: '/models', label: 'Models', icon: Cpu },
    { href: '/connections', label: 'Connections', icon: KeyRound },
    { href: '/agent', label: 'Coding Agent', icon: Code2 },
    { href: '/usage', label: 'Usage', icon: BarChart3 },
    { href: '/settings', label: 'Settings', icon: Sliders },
  ];

  if (user?.role === 'admin') {
    navLinks.push({ href: '/admin', label: 'Admin', icon: ShieldAlert });
  }

  return (
    <header className="sticky top-0 z-50 border-b border-[#232736] bg-[#0c0e14]/90 backdrop-blur-md px-4 sm:px-6 lg:px-8 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center space-x-6">
          <Link href="/" className="flex items-center space-x-2.5 group focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded-lg p-1">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-amber-600 to-orange-500 flex items-center justify-center shadow-md shadow-amber-900/30 group-hover:scale-105 transition-transform">
              <Zap className="w-4 h-4 text-white fill-white" />
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-base tracking-tight text-zinc-100 flex items-center gap-1.5 font-mono">
                SHAZAM<span className="text-amber-500 font-extrabold">.AI</span>
              </span>
              <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Task-First Intelligence</span>
            </div>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center space-x-1 text-sm font-medium">
            {navLinks.map((link) => {
              const Icon = link.icon;
              const isActive = pathname === link.href || (link.href !== '/' && pathname.startsWith(link.href));
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-3 py-1.5 rounded-md transition flex items-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                    isActive
                      ? 'bg-[#1b1f2d] text-amber-400 font-semibold'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#151824]'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-amber-400' : 'text-zinc-500'}`} />
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Right side Auth & Mobile Toggle */}
        <div className="flex items-center space-x-3">
          {loading ? null : user ? (
            <div className="hidden sm:flex items-center space-x-3 text-xs">
              <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-[#161a26] border border-[#232736] text-zinc-300">
                <UserIcon className="w-3.5 h-3.5 text-zinc-400" />
                <span className="font-mono text-zinc-300 max-w-[140px] truncate">{user.email}</span>
                {user.role === 'admin' && (
                  <span className="ml-1 px-1.5 py-0.2 rounded text-[10px] bg-amber-950 text-amber-400 border border-amber-800 font-mono">
                    ADMIN
                  </span>
                )}
              </div>
              <button
                onClick={handleLogout}
                title="Log out"
                className="p-1.5 text-zinc-400 hover:text-red-400 hover:bg-[#1a1e2c] rounded-md transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="hidden sm:flex items-center space-x-2">
              <Link
                href="/login"
                className="px-3 py-1.5 text-xs font-medium text-zinc-300 hover:text-white rounded-md hover:bg-[#161a26] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
              >
                Sign In
              </Link>
              <Link
                href="/signup"
                className="px-3 py-1.5 text-xs font-semibold text-zinc-900 bg-amber-500 hover:bg-amber-400 rounded-md transition shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
              >
                Sign Up
              </Link>
            </div>
          )}

          {/* Mobile Menu Button */}
          <button
            type="button"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle navigation menu"
            className="md:hidden p-2 rounded-md text-zinc-400 hover:text-white hover:bg-[#161a26] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer Menu (375px compatible) */}
      {mobileOpen && (
        <div className="md:hidden pt-4 pb-3 border-t border-[#232736] mt-3 space-y-1">
          {navLinks.map((link) => {
            const Icon = link.icon;
            const isActive = pathname === link.href || (link.href !== '/' && pathname.startsWith(link.href));
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium ${
                  isActive
                    ? 'bg-[#1b1f2d] text-amber-400 font-semibold'
                    : 'text-zinc-300 hover:bg-[#151824]'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-amber-400' : 'text-zinc-500'}`} />
                {link.label}
              </Link>
            );
          })}

          <div className="pt-3 border-t border-[#232736] px-3">
            {user ? (
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span className="font-mono truncate">{user.email}</span>
                <button
                  onClick={() => {
                    setMobileOpen(false);
                    handleLogout();
                  }}
                  className="text-red-400 hover:underline flex items-center gap-1"
                >
                  <LogOut className="w-3.5 h-3.5" /> Log out
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Link
                  href="/login"
                  onClick={() => setMobileOpen(false)}
                  className="flex-1 text-center py-2 text-xs font-medium text-zinc-300 bg-[#161a26] rounded-md"
                >
                  Sign In
                </Link>
                <Link
                  href="/signup"
                  onClick={() => setMobileOpen(false)}
                  className="flex-1 text-center py-2 text-xs font-semibold text-zinc-900 bg-amber-500 rounded-md"
                >
                  Sign Up
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
