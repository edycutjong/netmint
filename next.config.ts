import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // the lookup reads the committed block index, chain-supply baseline, per-issuer offsets and cached mints at runtime
  outputFileTracingIncludes: {
    '/api/lookup': ['./data/**/*.json'],
    '/': ['./data/**/*.json'],
    '/api/holders': ['./data/mints.json'],
    '/api/health': ['./evidence/*/flows-*d.json', './data/chain-supply/manifest.json'],
    '/flows': ['./evidence/*/flows-*d.json'],
  },
};

export default nextConfig;
