import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@novel/core'],
  serverExternalPackages: ['better-sqlite3'],
};

// 端口通过 PORT 环境变量设置,默认 33000
export default nextConfig;
