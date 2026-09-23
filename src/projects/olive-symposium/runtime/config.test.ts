import { describe, expect, it } from 'vitest';
import { oliveConfig } from './config';

describe('optional Olive configuration', () => {
  it('does not inspect legacy credentials, database or Python when disabled', () => {
    expect(
      oliveConfig({ OLIVE_ENABLED: 'false', OLIVE_LEGACY_ORIGIN: 'invalid' }),
    ).toEqual({ mode: 'disabled' });
  });

  it('requires credentials only for a managed legacy process', () => {
    expect(() => oliveConfig({})).toThrow('OLIVE_ADMIN_PASSWORD');
    expect(
      oliveConfig({ OLIVE_LEGACY_ORIGIN: 'http://127.0.0.1:8132/' }),
    ).toEqual({
      mode: 'external',
      origin: 'http://127.0.0.1:8132',
    });
  });

  it.each([
    'http://example.com',
    'https://127.0.0.1',
    'http://127.0.0.1/private',
    'http://secret@127.0.0.1',
    'http://127.0.0.1/?secret',
  ])(
    'rejects untrusted or malformed backend addresses without exposing them',
    (origin) => {
      expect(() => oliveConfig({ OLIVE_LEGACY_ORIGIN: origin })).toThrow(
        'OLIVE_LEGACY_ORIGIN ist ungültig.',
      );
    },
  );
});
