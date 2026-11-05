'use client';

import { LogoMark } from '@/components/brand/Logo';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Zap, ArrowRight, AlertCircle } from 'lucide-react';
import { errMessage } from '@/lib/errors';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      let data: any = {};
      try {
        data = await res.json();
      } catch {
        // Non-JSON response
      }

      if (!res.ok) {
        if (res.status === 401) {
          throw new Error('Invalid email or password. Please verify and try again.');
        } else if (res.status === 403) {
          throw new Error(data.error || 'Access restricted. Please contact your workspace administrator.');
        } else if (res.status === 429) {
          throw new Error('Too many login attempts. Please wait a minute and try again.');
        } else if (res.status >= 500) {
          throw new Error('Authentication service is temporarily unavailable. Please retry in a few moments.');
        }
        throw new Error(data.error || 'Login failed. Please check your credentials.');
      }

      // Only same-site relative paths (no "//host" or scheme) to avoid open redirects.
      const next = new URLSearchParams(window.location.search).get('next') || '';
      router.push(/^\/(?!\/)[\w\-./?=&%]*$/.test(next) ? next : '/agent');
      router.refresh();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="shz-atmosphere flex-1 h-full min-h-0 overflow-y-auto flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-2xl border border-line/[0.08] bg-surface/90 p-6 shadow-2xl backdrop-blur sm:p-8">
        <div className="flex flex-col items-center mb-6 text-center">
          <LogoMark size={40} className="mb-4" />
          <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">Welcome back</h1>
          <p className="mt-1 text-[13px] text-ink-3">Sign in to your free agents.</p>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-950/50 border border-red-800 text-red-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-ink-2 mb-1.5">Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2 bg-canvas border border-line/10 rounded-lg text-sm text-ink placeholder:text-ink-3 focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand"
              placeholder="you@domain.com"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-ink-2 mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-3 py-2 bg-canvas border border-line/10 rounded-lg text-sm text-ink placeholder:text-ink-3 focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 bg-brand hover:bg-brand-soft text-brand-ink font-semibold text-xs rounded-lg transition flex items-center justify-center gap-1.5 shadow-md disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign In'}
            {!loading && <ArrowRight className="w-3.5 h-3.5" />}
          </button>
        </form>

        <div className="mt-6 text-center text-xs text-ink-2">
          Don&apos;t have an account?{' '}
          <Link href="/signup" className="text-brand hover:underline font-medium">
            Create an account
          </Link>
        </div>
        <p className="mt-4 flex justify-center gap-4 text-[11px] text-ink-3">
          <Link href="/privacy" className="hover:text-ink-2">Privacy</Link>
          <Link href="/terms" className="hover:text-ink-2">Terms</Link>
        </p>
      </div>
    </div>
  );
}
