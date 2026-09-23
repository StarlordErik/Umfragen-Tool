import {
  isLegacyPath,
  proxyOlive,
} from '@/projects/olive-symposium/server/proxy';
import { OLIVE_BASE } from '@/projects/olive-symposium/server/mount';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ legacyPath: string[] }> };

/** Old bookmarks and old open browser tabs continue to work during migration. */
export async function GET(request: Request, context: Context) {
  const { legacyPath } = await context.params;
  const path = `/${legacyPath.join('/')}`;
  if (!isLegacyPath(path))
    return new Response('Nicht gefunden.', { status: 404 });
  if (path.startsWith('/api/') || path.startsWith('/static/'))
    return proxyOlive(request, path);
  const url = new URL(request.url);
  url.pathname = `${OLIVE_BASE}${path}`;
  return Response.redirect(url, 307);
}
export const POST = GET;
