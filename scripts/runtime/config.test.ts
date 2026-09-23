import { describe, expect, it } from 'vitest';
import { argumentsFor, platformConfig } from './config';

describe('platform configuration', () => {
  it('needs no project or Python configuration and preserves CLI overrides', () => {
    expect(platformConfig({}, argumentsFor([]))).toEqual({
      hostname: '0.0.0.0',
      port: 8000,
      production: false,
      openBrowser: false,
    });
    expect(
      platformConfig(
        { PORT: '8000' },
        argumentsFor(['--port', '9000', '--production']),
      ),
    ).toMatchObject({
      port: 9000,
      production: true,
    });
  });

  it.each(['0', '65536', '3.5', 'invalid-private-value', ''])(
    'rejects invalid ports (%s) without logging values',
    (value) => {
      expect(() => platformConfig({ PORT: value }, argumentsFor([]))).toThrow(
        'Ungültige Plattform-Konfiguration: PORT.',
      );
    },
  );
});
