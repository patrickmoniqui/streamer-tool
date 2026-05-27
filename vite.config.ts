import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import packageJson from './package.json';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ command }) => {
  const useLocalWorker = process.env.USE_LOCAL_WORKER === '1';
  const buildNumber = process.env.GITHUB_RUN_NUMBER ?? '';
  const proxyTarget = useLocalWorker
    ? 'http://127.0.0.1:8787'
    : 'https://api-web.nhle.com/v1';
  const rewriteApiPath = useLocalWorker
    ? (path: string) => path
    : (path: string) => path.replace(/^\/api/, '');
  const rewriteRedirectLocation = (location: string | undefined): string | undefined => {
    if (!location || useLocalWorker) {
      return location;
    }

    try {
      const redirectUrl = new URL(location, proxyTarget);

      if (redirectUrl.origin !== 'https://api-web.nhle.com') {
        return location;
      }

      return `/api${redirectUrl.pathname.replace(/^\/v1/, '')}${redirectUrl.search}`;
    } catch {
      return location;
    }
  };

  return {
    base: command === 'build' ? './' : '/',
    define: {
      __APP_VERSION__: JSON.stringify(packageJson.version),
      __APP_BUILD_NUMBER__: JSON.stringify(buildNumber),
    },
    plugins: [react()],
    server: {
      host: true,
      port: 5173,
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
          rewrite: rewriteApiPath,
          configure(proxy) {
            proxy.on('proxyRes', (proxyResponse) => {
              const locationHeader = proxyResponse.headers.location;

              const rewrittenLocation = rewriteRedirectLocation(
                typeof locationHeader === 'string' ? locationHeader : undefined,
              );

              if (rewrittenLocation) {
                proxyResponse.headers.location = rewrittenLocation;
              }
            });
          },
        },
      },
    },
    build: {
      rollupOptions: {
        input: {
          home: resolve(rootDir, 'index.html'),
          overlay: resolve(rootDir, 'overlay.html'),
          admin: resolve(rootDir, 'admin/index.html'),
          gameScore: resolve(rootDir, 'game-score/index.html'),
          gameScoreOverlay: resolve(rootDir, 'game-score/overlay.html'),
          liveGoalOverlay: resolve(rootDir, 'live-goal/overlay.html'),
        },
      },
    },
  };
});
