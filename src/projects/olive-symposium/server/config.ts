import 'server-only';
import { internalOrigin } from '../runtime/config';

export function legacyOrigin(): string {
  if (process.env.OLIVE_ENABLED === 'false')
    throw new Error('Project disabled.');
  return internalOrigin.parse(process.env.OLIVE_LEGACY_ORIGIN);
}
