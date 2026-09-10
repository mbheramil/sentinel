import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  transpilePackages: ['@sentinel/db', '@sentinel/shared', '@sentinel/ui', '@sentinel/ir'],
  experimental: { typedRoutes: false },
  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'connect-src', value: 'http://161.35.53.32:3001' },
      ],
    }];
  },
};

export default nextConfig;
