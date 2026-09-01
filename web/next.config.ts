import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@novel/core'],
  serverExternalPackages: ['better-sqlite3'],

  // 缓存策略(分层):
  //  1. 个人/账号/会话相关页面 —— no-store,禁止 CDN/反代/浏览器缓存(依赖 cookie,误缓存会串号/留旧数据)。
  //  2. 公开阅读页(书籍详情、章节、分类、短篇)—— 交给页面自身的 ISR 出口 `export const revalidate`
  //     决定 Cache-Control(Next 会返回 s-maxage=<revalidate>, stale-while-revalidate),此处不再覆盖。
  //  3. 其余动态页(首页/书架列表/搜索,读 cookie 或 searchParams)—— 由 Next 按动态路由处理,不在此层缓存。
  //  说明:不再全局覆盖为 no-store。安全性由「公开页显式设置 revalidate(ISR)」保证 —— 不会落入
  //  Next 对纯静态预渲染页的默认 s-maxage=31536000 风险。
  async headers() {
    return [
      { source: '/', headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }] },
      { source: '/me/:path*', headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }] },
      { source: '/shelf/:path*', headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }] },
      { source: '/admin/:path*', headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }] },
      { source: '/login', headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }] },
      { source: '/register', headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }] },
    ];
  },
};

// 端口通过 PORT 环境变量设置,默认 33000
export default nextConfig;
