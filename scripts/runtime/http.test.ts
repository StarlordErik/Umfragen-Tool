import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { listen, setTrustedForwardingHeaders } from './http';

describe('public HTTP boundary', () => {
  it('replaces every spoofable forwarding header with the socket and actual host', () => {
    const request = {
      socket: { remoteAddress: '::ffff:192.168.1.12' },
      headers: {
        host: '192.168.1.10:8000',
        'x-olive-client-ip': 'attacker',
        'x-forwarded-for': 'attacker',
        'x-forwarded-host': 'attacker',
        'x-forwarded-proto': 'https',
      },
    };
    setTrustedForwardingHeaders(request);
    expect(request.headers).toEqual({
      host: '192.168.1.10:8000',
      'x-olive-client-ip': '192.168.1.12',
      'x-forwarded-for': '192.168.1.12',
      'x-forwarded-host': '192.168.1.10:8000',
      'x-forwarded-proto': 'http',
    });
  });

  it('only allows automatic port fallback in development', async () => {
    const occupied = createServer();
    const development = createServer();
    const production = createServer();
    try {
      await new Promise<void>((resolve) =>
        occupied.listen(0, '127.0.0.1', resolve),
      );
      const address = occupied.address();
      if (!address || typeof address === 'string')
        throw new Error('No TCP address');
      await expect(
        listen(production, '127.0.0.1', address.port, false),
      ).rejects.toThrow('nicht öffnen');
      expect(
        await listen(development, '127.0.0.1', address.port, true),
      ).toBeGreaterThan(address.port);
    } finally {
      occupied.close();
      development.close();
      production.close();
    }
  });
});
