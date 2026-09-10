import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Type errors fail the build. This was switched off during an incident and
  // that is precisely how ~40 type errors accumulated unnoticed: the API and
  // runner run under `tsx`, which strips types without checking them, so the
  // web build was the only place type errors could surface.
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },
  transpilePackages: ['@sentinel/db', '@sentinel/shared', '@sentinel/ui', '@sentinel/ir'],
  experimental: { typedRoutes: false },
  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        // NB: no `connect-src` here — that is a CSP *directive*, not an HTTP
        // header, so setting it standalone did nothing. The API origin the
        // browser talks to comes from NEXT_PUBLIC_API_URL at build time.
      ],
    }];
  },
};

export default nextConfig;
