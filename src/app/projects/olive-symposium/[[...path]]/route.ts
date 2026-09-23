import { proxyOlive } from '@/projects/olive-symposium/server/proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ path?: string[] }> };

export async function GET(request: Request, context: Context) {
  const { path = [] } = await context.params;
  return proxyOlive(request, `/${path.join('/')}`);
}
export const POST = GET;
