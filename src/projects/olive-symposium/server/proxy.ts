import 'server-only';
import { legacyOrigin } from './config';
import { mountDocument, mountScript, OLIVE_BASE } from './mount';

const pages = new Set([
  '/',
  '/ergebnisse',
  '/einzelne-oel-wertungen',
  '/individuelle-ergebnisse',
  '/kompetitive-verkostung',
  '/oel-auswahl',
]);
const assets = new Set([
  'styles.css',
  'home.js',
  'survey.js',
  'results.js',
  'oils.js',
]);
const api = new Set([
  'bootstrap',
  'participant',
  'participant/logout',
  'results',
  'response',
  'submissions',
  'config',
  'oils',
  'oils/add',
  'oils/update',
  'oils/remove',
  'oils/participants/add',
  'oils/participants/update',
  'oils/participants/reset-pin',
  'oils/participants/delete',
  'oils/event-mode',
  'oils/event-finished',
  'oils/shuffle-ciphers',
  'oils/add-dummy-data',
  'oils/reset-db',
]);

export function isLegacyPath(path: string): boolean {
  return (
    pages.has(path) ||
    /^\/umfrage\/[a-z0-9-]+$/.test(path) ||
    (path.startsWith('/static/') && assets.has(path.slice(8))) ||
    (path.startsWith('/api/') && api.has(path.slice(5)))
  );
}

function error(status: number, message: string) {
  return Response.json(
    { ok: false, error: message },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

async function readBody(request: Request): Promise<Uint8Array | undefined> {
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_000_000) {
        await reader.cancel();
        throw new RangeError('Request ist zu groß.');
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(parts);
}

/** No React rendering, framework CSS or cache is introduced into legacy documents. */
export async function proxyOlive(
  request: Request,
  path: string,
): Promise<Response> {
  if (!isLegacyPath(path)) return error(404, 'Nicht gefunden.');
  const incoming = new URL(request.url);
  if (request.method === 'POST') {
    const origin = request.headers.get('origin');
    // Next may construct request.url with its internal hostname. The Host header
    // is the browser's actual destination, also for localhost and WLAN addresses.
    if (origin) {
      try {
        const source = new URL(origin);
        if (
          source.host !== request.headers.get('host') ||
          source.protocol !== incoming.protocol
        )
          return error(403, 'Ungültiger Ursprung.');
      } catch {
        return error(403, 'Ungültiger Ursprung.');
      }
    }
    if (request.headers.get('sec-fetch-site') === 'cross-site')
      return error(403, 'Ungültiger Ursprung.');
  }
  try {
    const body =
      request.method === 'POST' ? await readBody(request) : undefined;
    const headers = new Headers();
    for (const key of [
      'cookie',
      'content-type',
      'user-agent',
      'accept',
      'x-olive-client-ip',
    ]) {
      const value = request.headers.get(key);
      if (value) headers.set(key, value);
    }
    // Prevent compression so byte-preserving CSS transport and text mounting are explicit.
    headers.set('accept-encoding', 'identity');
    const response = await fetch(`${legacyOrigin()}${path}${incoming.search}`, {
      method: request.method,
      headers,
      body: body as BodyInit | undefined,
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
    const outgoing = new Headers({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    const contentType =
      response.headers.get('content-type') ?? 'application/octet-stream';
    outgoing.set('Content-Type', contentType);
    for (const cookie of response.headers.getSetCookie())
      outgoing.append('Set-Cookie', cookie);
    const location = response.headers.get('location');
    if (location?.startsWith('/') && !location.startsWith('//'))
      outgoing.set('Location', `${OLIVE_BASE}${location}`);
    if (contentType.includes('text/html'))
      return new Response(mountDocument(await response.text()), {
        status: response.status,
        headers: outgoing,
      });
    if (path.endsWith('.js')) {
      outgoing.set('Content-Type', 'text/javascript; charset=utf-8');
      return new Response(mountScript(await response.text()), {
        status: response.status,
        headers: outgoing,
      });
    }
    return new Response(await response.arrayBuffer(), {
      status: response.status,
      headers: outgoing,
    });
  } catch (cause) {
    if (cause instanceof RangeError) return error(413, cause.message);
    // Never expose filesystem paths, configuration or backend exception details.
    return error(
      503,
      'Das Projekt ist vorübergehend nicht erreichbar. Bitte erneut versuchen.',
    );
  }
}
