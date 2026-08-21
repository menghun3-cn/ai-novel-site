import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@novel/core'],
  serverExternalPackages: ['better-sqlite3'],
};

export default nextConfig;
