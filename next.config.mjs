/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Next.js devtool segment explorer иногда ломает React Client Manifest в dev-режиме,
    // из-за чего страница может падать на SSR/pre-render и отдавать 500 (см. /cabinet логи).
    devtoolSegmentExplorer: false,
  },

  /**
   * Windows: Watchpack иногда пытается lstat системные файлы в корне диска (EINVAL).
   * Сужаем watch + отключаем followSymlinks. При повторяющихся ошибках см. docs/windows-dev.md
   */
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        aggregateTimeout: 600,
        followSymlinks: false,
        ignored: [
          '**/node_modules/**',
          '**/.git/**',
          '**/.next/**',
          '**/DrWeb Quarantine/**',
          '**/System Volume Information/**',
        ],
      };
    }
    return config;
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
        ],
      },
      {
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
    ];
  },
};

export default nextConfig;

