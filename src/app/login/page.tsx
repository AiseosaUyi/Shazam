'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Zap, ArrowRight, AlertCircle } from 'lucide-react';

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

      router.push('/agent');
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex-1 h-full min-h-0 overflow-y-auto flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md bg-[#10131d] border border-[#232736] rounded-xl p-6 sm:p-8 shadow-2xl">
        <div className="flex flex-col items-center mb-6 text-center">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-600 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-900/30 mb-3">
            <Zap className="w-5 h-5 text-white fill-white" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-white font-mono">Sign in to Shazam AI</h1>
          <p className="text-xs text-zinc-400 mt-1">Access intelligent multi-model routing and task execution</p>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-950/50 border border-red-800 text-red-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2 bg-[#090b10] border border-[#232736] rounded-lg text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
              placeholder="you@domain.com"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-3 py-2 bg-[#090b10] border border-[#232736] rounded-lg text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-xs rounded-lg transition flex items-center justify-center gap-1.5 shadow-md disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign In'}
            {!loading && <ArrowRight className="w-3.5 h-3.5" />}
          </button>
        </form>

        <div className="mt-6 text-center text-xs text-zinc-400">
          Don&apos;t have an account?{' '}
          <Link href="/signup" className="text-amber-400 hover:underline font-medium">
            Create an account
          </Link>
        </div>
      </div>
    </div>
  );
}
