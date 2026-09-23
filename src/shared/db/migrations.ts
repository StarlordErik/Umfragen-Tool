import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { assertIntegrity } from './project-database.ts';

export type Migration = Readonly<{ id: string; up: string; down: string }>;
const appliedSchema = z.array(
  z.object({ id: z.string(), checksum: z.string() }),
);
const checksum = (migration: Migration) =>
  createHash('sha256')
    .update(migration.up)
    .update('\0')
    .update(migration.down)
    .digest('hex');

function applied(db: DatabaseSync) {
  if (
    !db
      .prepare(
        "SELECT name FROM sqlite_master WHERE name = '_project_migrations'",
      )
      .get()
  )
    return [];
  return appliedSchema.parse(
    db
      .prepare('SELECT id, checksum FROM _project_migrations ORDER BY position')
      .all(),
  );
}

export function migrationStatus(
  db: DatabaseSync,
  migrations: readonly Migration[],
) {
  if (new Set(migrations.map((item) => item.id)).size !== migrations.length)
    throw new Error('Doppelte Migrations-ID.');
  const history = applied(db);
  for (const [index, row] of history.entries()) {
    const migration = migrations[index];
    if (
      !migration ||
      migration.id !== row.id ||
      row.checksum !== checksum(migration)
    )
      throw new Error('Die angewandte Migrationshistorie wurde verändert.');
  }
  return {
    applied: history.map((row) => row.id),
    pending: migrations.slice(history.length),
  };
}

/** SQL files are trusted repository code; all values still use bound parameters. */
export function migrate(
  db: DatabaseSync,
  migrations: readonly Migration[],
): string[] {
  db.exec('BEGIN IMMEDIATE');
  try {
    const status = migrationStatus(db, migrations);
    if (!status.pending.length) {
      db.exec('COMMIT');
      return [];
    }
    db.exec(
      'CREATE TABLE IF NOT EXISTS _project_migrations (position INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)',
    );
    for (const [index, migration] of status.pending.entries()) {
      db.exec(migration.up);
      db.prepare(
        'INSERT INTO _project_migrations (position,id,checksum,applied_at) VALUES (?,?,?,?)',
      ).run(
        status.applied.length + index,
        migration.id,
        checksum(migration),
        new Date().toISOString(),
      );
    }
    assertIntegrity(db);
    db.exec('COMMIT');
    return status.pending.map((item) => item.id);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** Rolls back one additive migration. The caller must back up first. */
export function rollbackLast(
  db: DatabaseSync,
  migrations: readonly Migration[],
): string | undefined {
  db.exec('BEGIN IMMEDIATE');
  try {
    const status = migrationStatus(db, migrations);
    const migration = migrations[status.applied.length - 1];
    if (migration) {
      db.exec(migration.down);
      db.prepare('DELETE FROM _project_migrations WHERE id = ?').run(
        migration.id,
      );
    }
    assertIntegrity(db);
    db.exec('COMMIT');
    return migration?.id;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** SQLite's backup API includes committed WAL data, unlike copying just the file. */
export async function backupDatabase(
  db: DatabaseSync,
  directory: string,
  projectId: string,
): Promise<string> {
  mkdirSync(directory, { recursive: true });
  const target = resolve(
    directory,
    `${projectId}-${Date.now()}-${randomUUID()}.sqlite`,
  );
  await backup(db, target);
  const check = new DatabaseSync(target, { readOnly: true });
  try {
    assertIntegrity(check);
  } finally {
    check.close();
  }
  return target;
}
