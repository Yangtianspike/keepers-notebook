import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "守秘人笔记本 · COC 本地备本工作台",
  description:
    "把模组整理成一册可检索、可编辑、可追溯的主持笔记。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
