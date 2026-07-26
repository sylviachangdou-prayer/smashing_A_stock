import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const ogImage = `${protocol}://${host}/og.png`;

  return {
    title: "A股公司研究台｜官方披露驱动的公司研究",
    description: "输入A股公司名称或代码，研究股东、财务、资金面、主营业务、同业竞争与重大合同，并回溯官方来源。",
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      title: "A股公司研究台",
      description: "把资金、业务和合同放回证据链。",
      images: [ogImage],
    },
    twitter: {
      card: "summary_large_image",
      title: "A股公司研究台",
      description: "官方披露驱动的 A 股公司研究终端",
      images: [ogImage],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
