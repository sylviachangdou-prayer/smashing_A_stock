import type { NextConfig } from "next";

// 默认走 vinext 的 Cloudflare Worker 构建。
// 设了 STATIC_EXPORT 才导出纯静态站（GitHub Pages 用），
// NEXT_PUBLIC_BASE_PATH 是仓库子路径，例如 /smashing_A_stock。
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = process.env.STATIC_EXPORT
  ? {
      output: "export",
      images: { unoptimized: true },
      basePath,
      assetPrefix: basePath || undefined,
      trailingSlash: true,
    }
  : {};

export default nextConfig;
