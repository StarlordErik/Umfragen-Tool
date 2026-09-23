import { z } from 'zod';

export class OliveConfigurationError extends Error {}

export const internalOrigin = z
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === 'http:' &&
      url.hostname === '127.0.0.1' &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
    );
  }, 'The legacy backend must be a loopback HTTP origin.')
  .transform((value) => new URL(value).origin);

const managed = z.object({
  password: z.string().min(1),
  python: z.string().min(1).optional(),
  startupTimeout: z.coerce.number().int().min(100).max(120_000).default(15_000),
});

export function oliveConfig(env: Readonly<Record<string, string | undefined>>) {
  if (env.OLIVE_ENABLED === 'false') return { mode: 'disabled' } as const;
  if (env.OLIVE_ENABLED !== undefined && env.OLIVE_ENABLED !== 'true')
    throw new OliveConfigurationError(
      'OLIVE_ENABLED muss true oder false sein.',
    );
  if (env.OLIVE_LEGACY_ORIGIN) {
    const result = internalOrigin.safeParse(env.OLIVE_LEGACY_ORIGIN);
    if (!result.success)
      throw new OliveConfigurationError('OLIVE_LEGACY_ORIGIN ist ungültig.');
    return { mode: 'external', origin: result.data } as const;
  }
  const result = managed.safeParse({
    password: env.OLIVE_ADMIN_PASSWORD,
    python: env.OLIVE_PYTHON,
    startupTimeout: env.OLIVE_STARTUP_TIMEOUT_MS,
  });
  if (!result.success)
    throw new OliveConfigurationError(
      'OLIVE_ADMIN_PASSWORD, OLIVE_PYTHON und OLIVE_STARTUP_TIMEOUT_MS prüfen.',
    );
  return { mode: 'managed', ...result.data } as const;
}
