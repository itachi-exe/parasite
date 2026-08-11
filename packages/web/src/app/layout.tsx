import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Parasite — Virelia Research Outpost',
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
  themeColor: '#04130f',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
