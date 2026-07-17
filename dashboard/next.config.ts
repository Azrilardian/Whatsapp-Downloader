import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // shared/ ships TS source; Next transpiles it for the dashboard build.
  transpilePackages: ['@wadl/shared'],
  serverExternalPackages: ['better-sqlite3'],
};

export default nextConfig;
