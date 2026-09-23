import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import next from 'next';
import nextEnv from '@next/env';
import { startOliveRuntime } from '../src/projects/olive-symposium/runtime/start.ts';
import { argumentsFor, platformConfig } from './runtime/config.ts';
import {
  listen,
  localUrls,
  openBrowser,
  setTrustedForwardingHeaders,
} from './runtime/http.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);

async function run() {
  const args = argumentsFor(process.argv.slice(2));
  const production = args.production ?? process.env.NODE_ENV === 'production';
  Object.assign(process.env, {
    NODE_ENV: production ? 'production' : 'development',
  });
  nextEnv.loadEnvConfig(root, !production);
  const config = platformConfig(process.env, args);
  if (
    config.production &&
    !existsSync(new URL('../.next/BUILD_ID', import.meta.url))
  )
    throw new Error('Vor dem Produktionsstart bitte npm run build ausführen.');

  let app: ReturnType<typeof next> | undefined;
  let handle:
    ReturnType<ReturnType<typeof next>['getRequestHandler']> | undefined;
  let ready = false;
  const server = createServer((request, response) => {
    setTrustedForwardingHeaders(request);
    if (!ready || !handle) {
      response.writeHead(503, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Retry-After': '1',
        'Cache-Control': 'no-store',
      });
      response.end('Die Plattform startet. Bitte gleich erneut versuchen.');
      return;
    }
    void handle(request, response).catch(() => {
      console.error('[platform] HTTP-Anfrage fehlgeschlagen.');
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  let olive: ReturnType<typeof startOliveRuntime> | undefined;
  let stopping = false;
  async function stop(code = 0) {
    if (stopping) return;
    stopping = true;
    ready = false;
    const deadline = setTimeout(() => process.exit(code || 1), 10_000).unref();
    server.closeAllConnections();
    server.close();
    await Promise.allSettled([olive?.stop(), app?.close()]);
    clearTimeout(deadline);
    process.exit(code);
  }
  process.once('SIGINT', () => {
    void stop();
  });
  process.once('SIGTERM', () => {
    void stop();
  });
  if (process.env.PLATFORM_PARENT_PIPE === '1') {
    process.stdin.resume();
    process.stdin.once('end', () => {
      void stop();
    });
  }
  try {
    // Bind before any project can touch a database. Production never changes ports silently.
    const port = await listen(
      server,
      config.hostname,
      config.port,
      !config.production,
    );
    process.env.PORT = String(port);
    nextEnv.updateInitialEnv({ PORT: String(port) });
    olive = startOliveRuntime(root, { ...process.env }, (origin) => {
      process.env.OLIVE_LEGACY_ORIGIN = origin ?? '';
      // Next's dev reload must retain runtime values instead of an old .env origin.
      nextEnv.updateInitialEnv({ OLIVE_LEGACY_ORIGIN: origin ?? '' });
    });
    app = next({
      dev: !config.production,
      hostname: config.hostname,
      port,
      dir: root,
    });
    handle = app.getRequestHandler();
    await app.prepare();
    ready = true;
    const urls = localUrls(config.hostname, port);
    console.info(
      `[platform] Bereit (${config.production ? 'Produktion' : 'Entwicklung'}).`,
    );
    for (const [index, url] of urls.entries())
      console.info(`${index === 0 ? 'Lokal' : 'WLAN'}: ${url}`);
    if (config.openBrowser && urls[0]) openBrowser(urls[0]);
  } catch (error) {
    console.error(
      '[platform] Start fehlgeschlagen.',
      error instanceof Error ? error.message : 'Konfiguration prüfen.',
    );
    await stop(1);
  }
}

run().catch((error: unknown) => {
  console.error(
    '[platform]',
    error instanceof Error ? error.message : 'Start fehlgeschlagen.',
  );
  process.exitCode = 1;
});
