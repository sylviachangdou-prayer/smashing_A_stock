import type { NextConfig } from "next";

// 站点以纯静态导出发布到 GitHub Pages。
// NEXT_PUBLIC_BASE_PATH 是仓库子路径，例如 /smashing_A_stock；本地开发留空。
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  basePath,
  assetPrefix: basePath || undefined,
  trailingSlash: true,
};

export default nextConfig;
