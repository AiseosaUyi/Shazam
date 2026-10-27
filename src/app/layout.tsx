import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import {
  Compass,
  Cpu,
  KeyRound,
  BarChart3,
  Sliders,
  ShieldAlert,
  Zap,
} from 'lucide-react';

export const metadata: Metadata = {
  title: 'Shazam AI — Intelligent Multi-Model AI Routing Platform',
  description: 'Task-first, multi-provider AI workspace with intelligent routing, quota-aware fallback, and coding agent.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-slate-950 text-slate-100 flex flex-col min-h-screen selection:bg-sky-500 selection:text-white">
        {/* Navigation Header */}
        <header className="sticky top-0 z-50 border-b border-slate-800 bg-slate-950/80 backdrop-blur-md px-4 lg:px-8 py-3 flex items-center justify-between">
          <div className="flex items-center space-x-6">
            <Link href="/" className="flex items-center space-x-2.5 group">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-sky-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-sky-500/20 group-hover:scale-105 transition-transform">
                <Zap className="w-4 h-4 text-white fill-white" />
              </div>
              <div className="flex flex-col">
                <span className="font-bold text-base tracking-tight text-white flex items-center gap-1.5">
                  SHAZAM <span className="text-sky-400 font-extrabold">AI</span>
                </span>
                <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">Task-First Intelligence</span>
              </div>
            </Link>

            <nav className="hidden md:flex items-center space-x-1 text-sm font-medium">
              <Link
                href="/"
                className="px-3 py-1.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-900 transition flex items-center gap-1.5"
              >
                <Compass className="w-4 h-4 text-slate-400" />
                Workspace
              </Link>
              <Link
                href="/catalogue"
                className="px-3 py-1.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-900 transition flex items-center gap-1.5"
              >
                <Cpu className="w-4 h-4 text-slate-400" />
                Models
              </Link>
              <Link
                href="/connections"
                className="px-3 py-1.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-900 transition flex items-center gap-1.5"
              >
                <KeyRound className="w-4 h-4 text-slate-400" />
                Connections
              </Link>
              <Link
                href="/usage"
                className="px-3 py-1.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-900 transition flex items-center gap-1.5"
              >
                <BarChart3 className="w-4 h-4 text-slate-400" />
                Usage
              </Link>
              <Link
                href="/settings"
                className="px-3 py-1.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-900 transition flex items-center gap-1.5"
              >
                <Sliders className="w-4 h-4 text-slate-400" />
                Settings
              </Link>
              <Link
                href="/admin"
                className="px-3 py-1.5 rounded-md text-slate-300 hover:text-white hover:bg-slate-900 transition flex items-center gap-1.5"
              >
                <ShieldAlert className="w-4 h-4 text-slate-400" />
                Admin
              </Link>
            </nav>
          </div>

          <div className="flex items-center space-x-3 text-xs">
            <div className="hidden sm:flex items-center space-x-2 bg-slate-900/90 border border-slate-800 px-2.5 py-1 rounded-full">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span className="text-slate-300 font-mono">Router Active</span>
            </div>
            <div className="px-2.5 py-1 rounded-full bg-sky-950/60 border border-sky-800/60 text-sky-300 font-medium font-mono">
              BYOK Mode
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 flex flex-col">{children}</main>
      </body>
    </html>
  );
}
