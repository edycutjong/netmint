import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // the lookup reads the committed block index, chain-supply baseline, per-issuer offsets and cached mints at runtime
  outputFileTracingIncludes: {
    // + the committed verbatim CMC bodies that answer a plan-refused call after the key reverts (live-stored path)
    '/api/lookup': ['./data/**/*.json', './evidence/**/*.json'],
    '/': ['./data/**/*.json', './evidence/**/*.json'],
    '/api/holders': ['./data/mints.json'],
    '/api/health': ['./evidence/**/*.json', './data/chain-supply/manifest.json'],
    '/flows': ['./evidence/*/flows-*d.json'],
  },
};

export default nextConfig;
