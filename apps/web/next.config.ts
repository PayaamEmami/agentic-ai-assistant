import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@aaa/shared'],
  webpack: (config) => {
    // `@aaa/shared` is aliased to its TypeScript source, which uses ESM-style
    // `.js` extensions in relative imports. Map those back to `.ts`/`.tsx` so
    // webpack can resolve the source files during the build.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
      '.jsx': ['.tsx', '.jsx'],
    };
    return config;
  },
};

export default nextConfig;
