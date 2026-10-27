import type { Metadata } from 'next';
import './globals.css';
import { Navbar } from '@/components/Navbar';

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
      <body className="bg-[#090a0f] text-zinc-100 flex flex-col min-h-screen selection:bg-amber-500 selection:text-black antialiased font-sans">
        <Navbar />
        <main className="flex-1 flex flex-col">{children}</main>
      </body>
    </html>
  );
}
