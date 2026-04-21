import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Castrel Chaos · Traffic Control Plane',
  description: 'Traffic generation and chaos engineering control console',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="bg-gray-950 text-gray-100 min-h-screen antialiased">
        <div className="flex h-screen">
          <nav className="w-56 bg-gray-900 border-r border-gray-800 flex flex-col p-4 shrink-0">
            <div className="text-lg font-bold text-amber-400 mb-6 tracking-tight">
              Castrel Chaos
            </div>
            <a href="/" className="block py-2 px-3 rounded hover:bg-gray-800 text-sm mb-1">
              Overview
            </a>
            <a href="/runner" className="block py-2 px-3 rounded hover:bg-gray-800 text-sm mb-1">
              Runner
            </a>
            <a href="/chaos" className="block py-2 px-3 rounded hover:bg-gray-800 text-sm mb-1">
              Chaos Control
            </a>
            <a href="/scenarios" className="block py-2 px-3 rounded hover:bg-gray-800 text-sm mb-1">
              Scenarios
            </a>
            <div className="mt-auto text-xs text-gray-600">
              v1.0.0
            </div>
          </nav>
          <main className="flex-1 overflow-auto p-6">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
