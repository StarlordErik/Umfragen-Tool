import 'server-only';
import { legacyOrigin } from './config';

export async function oliveHealth(): Promise<Response> {
  let status: 'ok' | 'disabled' | 'unavailable' = 'unavailable';
  if (process.env.OLIVE_ENABLED === 'false') status = 'disabled';
  else {
    try {
      // This private endpoint creates no anonymous participant and reads no raw data.
      const response = await fetch(`${legacyOrigin()}/__health`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(1500),
      });
      if (response.ok && (await response.text()) === 'ok') status = 'ok';
    } catch {
      /* Only availability is public, never configuration or exception details. */
    }
  }
  return Response.json(
    { status },
    {
      status: status === 'ok' ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
