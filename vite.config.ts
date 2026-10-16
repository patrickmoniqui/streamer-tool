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
    plugins: [
      react(),
      {
        name: 'globe-channel-route',
        configureServer(server) {
          server.middlewares.use((request, response, next) => {
            const requestUrl = new URL(request.url ?? '/', 'http://localhost');
            const match = requestUrl.pathname.match(/^\/(globe|dancefloor)\/([A-Za-z0-9_]+)\/?$/);

            if (!match) {
              next();
              return;
            }

            requestUrl.pathname = `/${match[1]}/overlay.html`;
            requestUrl.hash = new URLSearchParams({ channel: match[2].toLowerCase() }).toString();
            requestUrl.searchParams.delete('speed');
            response.statusCode = 302;
            response.setHeader('Location', `${requestUrl.pathname}${requestUrl.search}${requestUrl.hash}`);
            response.end();
          });
        },
      },
    ],
    server: {
      host: true,
      port: 5173,
      proxy: {
        ...Object.fromEntries(['/api/twitch', '/api/dancefloor'].map(path => [path, {
          target: 'http://127.0.0.1:8787',
          changeOrigin: true,
          configure(proxy: import('vite').HttpProxy.ProxyServer) {
            proxy.on('error', (_error, _request, response) => {
              if ('writeHead' in response && !response.headersSent) {
                response.writeHead(503, { 'Content-Type': 'application/json' });
                response.end(JSON.stringify({ error: 'The Twitch connection Worker is not running. Start the app with npm run dev:all.' }));
              }
            });
          },
        }])),
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
          dancefloor: resolve(rootDir, 'dancefloor/index.html'),
          dancefloorOverlay: resolve(rootDir, 'dancefloor/overlay.html'),
          globe: resolve(rootDir, 'globe/index.html'),
          globeOverlay: resolve(rootDir, 'globe/overlay.html'),
          gameScore: resolve(rootDir, 'game-score/index.html'),
          gameScoreOverlay: resolve(rootDir, 'game-score/overlay.html'),
          liveGoalOverlay: resolve(rootDir, 'live-goal/overlay.html'),
          notFound: resolve(rootDir, '404.html'),
        },
      },
    },
  };
});
