import type { Metadata, Viewport } from 'next';
import { Inter, Newsreader } from 'next/font/google';
import { Providers } from '@/components/providers';
import { THEME_SCRIPT } from '@/components/theme';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const newsreader = Newsreader({ subsets: ['latin'], variable: '--font-newsreader', display: 'swap', style: ['normal', 'italic'] });

export const metadata: Metadata = {
  title: { default: 'Digital Opportunity Finder', template: '%s · Digital Opportunity Finder' },
  description: 'Evidence-based business development and CRM workspace for a Ghanaian digital agency.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafafa' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0b0d' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={`${inter.variable} ${newsreader.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh font-sans text-sm">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
