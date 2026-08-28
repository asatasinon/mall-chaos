import type { Metadata } from 'next';
import './globals.css';
import { ThemeProvider } from '@/components/ThemeProvider';
import ConsoleChrome from '@/components/ConsoleChrome';

export const metadata: Metadata = {
  title: 'Castrel Chaos · Fault Run Control Plane',
  description: 'Protected scenario coordination and recovery control console',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-background text-foreground antialiased h-screen overflow-hidden flex flex-col">
        <ThemeProvider>
          <ConsoleChrome>{children}</ConsoleChrome>
        </ThemeProvider>
      </body>
    </html>
  );
}
