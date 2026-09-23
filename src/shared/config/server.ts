import 'server-only';
import { z } from 'zod';

const internalOrigin = z.url().refine((value) => {
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
}, 'The legacy backend must be a loopback HTTP origin.');

export function legacyOrigin(): string {
  return internalOrigin.parse(process.env.OLIVE_LEGACY_ORIGIN);
}
