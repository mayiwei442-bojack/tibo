import type { Metadata } from 'next';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/barlow-condensed/600.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Codex Reset 监控 — Tibo 消息',
  description:
    "追踪 Tibo 关于 Codex usage、limits 与 Reset 的公开推文，保留英文原文，提供中文摘要与可选译文。",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
