import type { NextConfig } from 'next';
import type { Configuration as WebpackConfig } from 'webpack';

const nextConfig = {
  reactStrictMode: true,
  turbopack: {
    resolveAlias: {
      '@': 'src',
    },
  },
  webpack: (config: WebpackConfig) => {
    config.resolve = config.resolve ?? {};
    // Support explicit file extensions.
    // See https://github.com/vercel/next.js/discussions/32237#discussioncomment-4793595
    config.resolve.extensions = ['.js', '.jsx', '.ts', '.tsx'];

    return config;
  },
} satisfies NextConfig;

export default nextConfig;
