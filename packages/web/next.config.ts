import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'export',
  images: { unoptimized: true },
  experimental: { cpus: 1 },
  // The release script runs tsc separately after Next exits, avoiding overlapping heaps.
  typescript: { ignoreBuildErrors: true },
  // @parasite/shared is a TS workspace package consumed from source.
  transpilePackages: ['@parasite/shared'],
  webpack: (config) => {
    // Phaser expects a browser environment; never try to bundle it server-side.
    config.resolve.fallback = { ...config.resolve.fallback, fs: false, net: false, tls: false };
    return config;
  },
};

export default nextConfig;
