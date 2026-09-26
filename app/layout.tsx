import type { Metadata } from 'next';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/barlow-condensed/600.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Codex Reset Monitor — Tibo signals',
  description:
    "A focused monitor for Tibo's public posts about Codex usage, limits, and resets.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
