import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@novel/core'],
  serverExternalPackages: ['better-sqlite3'],

  // 站点 HTML 页面禁止共享缓存:防止 CDN/反向代理缓存了 404 或旧版本页面,
  // 导致部署后用户仍看到旧内容或 Stale 404。Next.js 默认对静态预渲染页面
  // 设置 s-maxage=31536000,在反向代理前极不安全。
  // 此处覆盖为 no-cache:浏览器每次导航都重新验证,CDN 不缓存。
  async headers() {
    return [
      {
        source: '/((?!_next/static|_next/image|api|media|favicon).*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate',
          },
        ],
      },
    ];
  },
};

// 端口通过 PORT 环境变量设置,默认 33000
export default nextConfig;
