import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Webpack in Next 15 doesn't know node:sqlite as a builtin, so leave it to Node at runtime.
  webpack: (config, { isServer }) => {
    if (isServer) {
      const existing = Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean);
      config.externals = [...existing, { 'node:sqlite': 'commonjs node:sqlite' }];
    }
    return config;
  },
};

export default nextConfig;
