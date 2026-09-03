import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@novel/core'],
  serverExternalPackages: [
    'better-sqlite3',
    // Kokoro 本地 TTS:onnxruntime-node 是原生 .node 模块,必须留给 Node 运行时加载,
    // 不能交给 webpack 打包;transformers.js 同样在运行时动态 require 原生绑定。
    // kokoro-js-zh 是支持中文的 fork(原版 kokoro-js 只有英文语音)。
    'kokoro-js-zh',
    '@huggingface/transformers',
    'onnxruntime-node',
    'phonemizer',
    'espeak-ng',
  ],

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
