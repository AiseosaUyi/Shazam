import type { Metadata } from 'next';
import './globals.css';
import { Navbar } from '@/components/Navbar';
import { DialogProvider } from '@/components/ui/dialog';

export const metadata: Metadata = {
  title: 'Shazam',
  description: 'Free AI agents that code, handle your inbox and make media.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark h-full">
      <body className="bg-canvas text-ink flex flex-col h-screen h-[100dvh] overflow-hidden selection:bg-brand selection:text-brand-ink antialiased font-sans">
        <DialogProvider>
          <Navbar />
          <main className="flex-1 min-h-0 flex flex-col overflow-hidden">{children}</main>
        </DialogProvider>
      </body>
    </html>
  );
}
