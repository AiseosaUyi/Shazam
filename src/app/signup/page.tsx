'use client';

import { LogoMark } from '@/components/brand/Logo';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Zap, ArrowRight, AlertCircle, ShieldCheck } from 'lucide-react';

export default function SignupPage() {
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
      const res = await fetch('/api/v1/auth/signup', {
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
        if (res.status === 409) {
          throw new Error('An account with this email already exists. Please sign in instead.');
        } else if (res.status === 429) {
          throw new Error('Too many registration attempts. Please wait a minute and try again.');
        } else if (res.status >= 500) {
          throw new Error('Registration service is temporarily unavailable. Please retry in a few moments.');
        }
        throw new Error(data.error || 'Registration failed. Please check your details.');
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
    <div className="shz-atmosphere flex-1 h-full min-h-0 overflow-y-auto flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-2xl border border-line/[0.08] bg-surface/90 p-6 shadow-2xl backdrop-blur sm:p-8">
        <div className="flex flex-col items-center mb-6 text-center">
          <LogoMark size={40} className="mb-4" />
          <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">Create your account</h1>
          <p className="mt-1 text-[13px] text-ink-3">Free agents that code, run your inbox and make media.</p>
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
            <label className="block text-xs font-medium text-ink-2 mb-1.5">Password (8+ characters)</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="w-full px-3 py-2 bg-canvas border border-line/10 rounded-lg text-sm text-ink placeholder:text-ink-3 focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand"
              placeholder="••••••••"
            />
          </div>

          <div className="p-3 bg-[#151926] border border-[#202538] rounded-lg flex items-start gap-2 text-ink-2 text-xs">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span>Your BYOK provider credentials are encrypted client-to-vault with AES-256-GCM. Free-only requests never incur paid API costs.</span>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 bg-brand hover:bg-brand-soft text-brand-ink font-semibold text-xs rounded-lg transition flex items-center justify-center gap-1.5 shadow-md disabled:opacity-50"
          >
            {loading ? 'Creating Account...' : 'Create Account'}
            {!loading && <ArrowRight className="w-3.5 h-3.5" />}
          </button>
        </form>

        <div className="mt-6 text-center text-xs text-ink-2">
          Already have an account?{' '}
          <Link href="/login" className="text-brand hover:underline font-medium">
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
