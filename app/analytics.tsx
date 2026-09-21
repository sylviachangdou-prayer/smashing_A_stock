"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

// 没有配 NEXT_PUBLIC_GA_ID 时整个组件不做任何事，本地开发默认就是关的。
const GA_ID = process.env.NEXT_PUBLIC_GA_ID ?? "";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/** 记一个自定义事件。GA 没启用时是空操作。 */
export function track(event: string, params?: Record<string, unknown>) {
  if (typeof window !== "undefined") {
    window.gtag?.("event", event, params ?? {});
  }
}

export function Analytics() {
  const pathname = usePathname();
  const loaded = useRef(false);

  useEffect(() => {
    if (!GA_ID || loaded.current) return;
    loaded.current = true;
    window.dataLayer = window.dataLayer ?? [];
    window.gtag = function gtag(...args: unknown[]) {
      window.dataLayer!.push(args);
    };
    window.gtag("js", new Date());
    // 关掉广告信号与个性化投放，只留基础使用统计；页面浏览由下面的 effect 自己发，
    // 这样客户端路由切换也能记上。
    window.gtag("config", GA_ID, {
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
    });
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
    document.head.appendChild(script);
  }, []);

  useEffect(() => {
    if (!GA_ID) return;
    window.gtag?.("event", "page_view", { page_path: pathname });
  }, [pathname]);

  return null;
}
