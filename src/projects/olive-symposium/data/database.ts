import 'server-only';
import type { ProjectDatabase } from '../../../shared/db/project-database.ts';
import type { Migration } from '../../../shared/db/migrations.ts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function oliveDatabase(): ProjectDatabase {
  return {
    id: 'olive-symposium',
    existingPath:
      process.env.OLIVE_DATABASE_PATH ||
      process.env.UMFRAGEN_DB ||
      'data/umfragen.sqlite3',
  };
}

/** Optional extension only. Never applied when starting the website. */
export function oliveMigrations(root = process.cwd()): readonly Migration[] {
  const directory = resolve(
    root,
    'src/projects/olive-symposium/data/migrations',
  );
  return [
    {
      id: '001-identity-links',
      up: readFileSync(resolve(directory, '001-identity-links.up.sql'), 'utf8'),
      down: readFileSync(
        resolve(directory, '001-identity-links.down.sql'),
        'utf8',
      ),
    },
  ];
}
