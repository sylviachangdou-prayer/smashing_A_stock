// GitHub Pages 把站点放在 /<仓库名> 子路径下。Next 会自动给 _next 资源加前缀，
// 但 metadata 里的 icon 和 next/image 的 src 字符串不会，这里统一补上。
// Cloudflare Worker 构建不设这个变量，前缀为空，路径与原来一致。
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
export const BRAND_MARK = `${BASE_PATH}/niu-oracle.svg`;
