import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import './globals.css';
import 'sonner/dist/styles.css';
import { ThemeProvider } from '@/components/ThemeProvider';
import ConsoleChrome from '@/components/ConsoleChrome';
import { Toaster } from '@/components/Toaster';

export const metadata: Metadata = {
  title: 'Castrel Chaos · Fault Run Control Plane',
  description: 'Protected scenario coordination and recovery control console',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="bg-background text-foreground antialiased h-screen overflow-hidden flex flex-col">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider>
            <ConsoleChrome>{children}</ConsoleChrome>
            <Toaster />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
