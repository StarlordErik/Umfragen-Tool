import { afterEach, describe, expect, it, vi } from 'vitest';
import { proxyOlive } from './proxy';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('legacy transport boundary', () => {
  it('preserves JSON and old cookies without adding a public cache', async () => {
    vi.stubEnv('OLIVE_LEGACY_ORIGIN', 'http://127.0.0.1:9999');
    const json = '{"answer":"/ergebnisse","id":42}';
    const fetcher = vi.fn().mockResolvedValue(
      new Response(json, {
        headers: {
          'content-type': 'application/json',
          'set-cookie':
            'oil_tasting_participant=old-token; Path=/; SameSite=Lax',
        },
      }),
    );
    vi.stubGlobal('fetch', fetcher);
    const response = await proxyOlive(
      new Request('http://localhost/api/participant'),
      '/api/participant',
    );
    expect(await response.text()).toBe(json);
    expect(response.headers.get('set-cookie')).toContain('old-token; Path=/');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('accepts a WLAN origin when Next uses an internal URL hostname', async () => {
    vi.stubEnv('OLIVE_LEGACY_ORIGIN', 'http://127.0.0.1:9999');
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetcher);
    const request = new Request('http://localhost:8000/api/participant', {
      method: 'POST',
      body: '{}',
      headers: {
        host: '192.168.1.20:8000',
        origin: 'http://192.168.1.20:8000',
      },
    });
    expect((await proxyOlive(request, '/api/participant')).status).toBe(200);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('blocks cross-site writes and unknown/private routes before contacting the backend', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    expect(
      (
        await proxyOlive(
          new Request('http://localhost/data/umfragen.sqlite3'),
          '/data/umfragen.sqlite3',
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await proxyOlive(
          new Request('http://localhost/api/participant', {
            method: 'POST',
            headers: { host: 'localhost', origin: 'https://outside.example' },
          }),
          '/api/participant',
        )
      ).status,
    ).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('limits streamed bodies even without a declared content-length', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const request = new Request('http://localhost/api/participant', {
      method: 'POST',
      body: 'x'.repeat(1_000_001),
    });
    expect((await proxyOlive(request, '/api/participant')).status).toBe(413);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns a safe availability error when the local backend is unavailable', async () => {
    vi.stubEnv('OLIVE_LEGACY_ORIGIN', 'http://127.0.0.1:9999');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('private filesystem path')),
    );
    const response = await proxyOlive(new Request('http://localhost/'), '/');
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private');
  });
});
