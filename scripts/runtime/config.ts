import { parseArgs } from 'node:util';
import { z } from 'zod';

const port = z.coerce.number().int().min(1).max(65535);
const environment = z.object({
  HOST: z.string().trim().min(1).default('0.0.0.0'),
  PORT: port.default(8000),
});

export function argumentsFor(argv: string[]) {
  return parseArgs({
    args: argv,
    options: {
      host: { type: 'string' },
      port: { type: 'string' },
      production: { type: 'boolean' },
      'open-browser': { type: 'boolean' },
      'no-browser': { type: 'boolean' },
    },
  }).values;
}

export function platformConfig(
  env: Readonly<Record<string, string | undefined>>,
  args: ReturnType<typeof argumentsFor>,
) {
  const parsed = environment.safeParse({
    HOST: args.host ?? env.HOST,
    PORT: args.port ?? env.PORT,
  });
  if (!parsed.success) {
    // Zod errors can include input values. Only disclose the offending keys.
    const keys = [
      ...new Set(parsed.error.issues.map((issue) => issue.path[0])),
    ];
    throw new Error(`Ungültige Plattform-Konfiguration: ${keys.join(', ')}.`);
  }
  return {
    hostname: parsed.data.HOST,
    port: parsed.data.PORT,
    production: args.production ?? env.NODE_ENV === 'production',
    openBrowser: !!args['open-browser'] && !args['no-browser'],
  };
}
