import type { Metadata, Viewport } from 'next';
import { Fredoka } from 'next/font/google';
import './globals.css';

/**
 * Display face for the title lockup and the primary buttons.
 *
 * Loaded through `next/font` rather than a stylesheet link so it is self-hosted
 * in the build output: no runtime request to a third party, no flash of
 * fallback type on a cold load, and nothing to configure in a CSP later. The
 * body face stays the existing monospace — the HUD is meant to read as
 * instrumentation, and only the menu wants a voice.
 */
const display = Fredoka({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-display',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Parasite: Virelia Research Outpost',
  description:
    'A real-time multiplayer social deduction game with hidden roles encrypted on-chain via Inco Lightning FHE.',
};

/**
 * `maximumScale`/`userScalable` are deliberately left at their permissive
 * defaults — pinch-zoom must not be disabled. `viewportFit: cover` lets the
 * shell reach under a notch, which the safe-area padding in globals.css then
 * accounts for.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0a0e13',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={display.variable}>
      <body>{children}</body>
    </html>
  );
}
