import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // the lookup reads the committed block index, chain-supply baseline, per-issuer offsets and cached mints at runtime
  outputFileTracingIncludes: {
    '/api/lookup': ['./data/**/*.json'],
    '/': ['./data/**/*.json'],
  },
};

export default nextConfig;
