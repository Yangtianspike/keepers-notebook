import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "守秘人图谱 · COC 本地备本工作台",
  description:
    "将文字模组整理为可核对的人物关系图、幕后真相与分支时间线。",
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
