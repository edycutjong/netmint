import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // CI builds with COMMIT_SHA set; baked in here so /api/health names the commit even when the host injects no git metadata
  ...(process.env.COMMIT_SHA ? { env: { COMMIT_SHA: process.env.COMMIT_SHA } } : {}),
  // the lookup reads the committed block index, chain-supply baseline, per-issuer offsets and cached mints at runtime
  outputFileTracingIncludes: {
    // + the committed verbatim CMC bodies that answer a call CMC refuses on plan or credits (live-stored path)
    '/api/lookup': ['./data/**/*.json', './evidence/**/*.json'],
    '/': ['./data/**/*.json', './evidence/**/*.json'],
    '/api/holders': ['./data/mints.json'],
    '/api/health': ['./evidence/**/*.json', './data/chain-supply/manifest.json'],
    '/flows': ['./evidence/*/flows-*d.json'],
  },
  // the landing (/about), the pitch deck (/pitch) and the judges' path (/judge) are static single files in public/, generated from the committed evidence
  async rewrites() {
    return {
      beforeFiles: [
        { source: '/about', destination: '/landing/index.html' },
        { source: '/pitch', destination: '/pitch/index.html' },
        { source: '/judge', destination: '/judge/index.html' },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
