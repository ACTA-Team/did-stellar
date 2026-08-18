import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, Geist_Mono, Newsreader } from 'next/font/google';

import './globals.css';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { SITE } from '@/lib/site';

/* Brand manual §04: Plus Jakarta Sans for UI, Geist Mono for DIDs.
   Newsreader is the display voice, used only for the handful of lines
   per screen that state the argument. */
const newsreader = Newsreader({
  variable: '--font-newsreader',
  subsets: ['latin'],
  weight: ['300', '400', '500'],
});

const jakarta = Plus_Jakarta_Sans({
  variable: '--font-jakarta',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
  weight: ['400', '500'],
});

export const metadata: Metadata = {
  title: {
    default: `${SITE.name} · ${SITE.tagline}`,
    template: `%s · ${SITE.name}`,
  },
  description: SITE.description,
  applicationName: SITE.name,
  openGraph: {
    title: `${SITE.name} · ${SITE.tagline}`,
    description: SITE.description,
    siteName: SITE.name,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE.name} · ${SITE.tagline}`,
    description: SITE.description,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${newsreader.variable} ${jakarta.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* Extensions inject attributes on <body> before React hydrates
          (bis_register, __processed_*), which reads as a mismatch. */}
      <body
        suppressHydrationWarning
        className="flex min-h-full flex-col bg-background font-sans text-foreground"
      >
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
