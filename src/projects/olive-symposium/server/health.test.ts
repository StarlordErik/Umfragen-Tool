import { afterEach, expect, it, vi } from 'vitest';
import { oliveHealth } from './health';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('checks a side-effect-free private endpoint without forwarding credentials', async () => {
  vi.stubEnv('OLIVE_LEGACY_ORIGIN', 'http://127.0.0.1:9876');
  const fetcher = vi.fn().mockResolvedValue(new Response('ok'));
  vi.stubGlobal('fetch', fetcher);
  const response = await oliveHealth();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok' });
  expect(fetcher).toHaveBeenCalledWith(
    'http://127.0.0.1:9876/__health',
    expect.objectContaining({ cache: 'no-store' }),
  );
});

it('exposes no private details on failure and contacts nothing when disabled', async () => {
  vi.stubEnv('OLIVE_LEGACY_ORIGIN', 'http://127.0.0.1:9876');
  const fetcher = vi.fn().mockRejectedValue(new Error('secret database path'));
  vi.stubGlobal('fetch', fetcher);
  const failure = await oliveHealth();
  expect(failure.status).toBe(503);
  expect(await failure.json()).toEqual({ status: 'unavailable' });
  vi.stubEnv('OLIVE_ENABLED', 'false');
  const disabled = await oliveHealth();
  expect(await disabled.json()).toEqual({ status: 'disabled' });
  expect(fetcher).toHaveBeenCalledOnce();
});
