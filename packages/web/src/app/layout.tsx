import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Parasite — Virelia Research Outpost',
  description:
    'A real-time multiplayer social deduction game with hidden roles encrypted on-chain via Inco Lightning FHE.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
