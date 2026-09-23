import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  assertIntegrity,
  databasePath,
  openProjectDatabase,
} from '@/shared/db/project-database';
import {
  backupDatabase,
  migrate,
  migrationStatus,
  rollbackLast,
  type Migration,
} from '@/shared/db/migrations';
import { oliveMigrations } from '@/projects/olive-symposium/data/database';

const directories: string[] = [];
function temporary() {
  const path = mkdtempSync(join(tmpdir(), 'projects-test-'));
  directories.push(path);
  return path;
}
afterEach(() => {
  for (const path of directories.splice(0))
    rmSync(path, { recursive: true, force: true });
});

describe('project databases', () => {
  it('separates project data, rejects path traversal, and never recreates a missing database', () => {
    const root = temporary();
    expect(() => databasePath({ id: '../outside' }, root)).toThrow();
    expect(() => openProjectDatabase({ id: 'missing' }, { root })).toThrow(
      /fehlt/,
    );
    const first = openProjectDatabase({ id: 'first' }, { root, create: true });
    const second = openProjectDatabase(
      { id: 'second' },
      { root, create: true },
    );
    try {
      first.exec(
        "CREATE TABLE answers (id TEXT); INSERT INTO answers VALUES ('only-first')",
      );
      expect(
        second
          .prepare("SELECT name FROM sqlite_master WHERE name='answers'")
          .get(),
      ).toBeUndefined();
      assertIntegrity(first);
      assertIntegrity(second);
    } finally {
      first.close();
      second.close();
    }
  });

  it('applies and reverses the optional identity mapping without modifying legacy rows', async () => {
    const root = temporary();
    const db = openProjectDatabase(
      { id: 'olive-test' },
      { root, create: true },
    );
    try {
      db.exec(
        "CREATE TABLE respondents (id INTEGER PRIMARY KEY, display_name TEXT); INSERT INTO respondents VALUES (42,'Legacy');",
      );
      const before = db.prepare('SELECT * FROM respondents').all();
      const migrations = oliveMigrations();
      expect(migrate(db, migrations)).toEqual(['001-identity-links']);
      expect(migrate(db, migrations)).toEqual([]);
      db.prepare('INSERT INTO legacy_user_mappings VALUES (?,?,?,?)').run(
        42,
        'global-stable-id',
        '2026-01-01',
        'verified-admin',
      );
      expect(() =>
        db
          .prepare('INSERT INTO legacy_user_mappings VALUES (?,?,?,?)')
          .run(99, 'invalid', 'now', 'admin'),
      ).toThrow();
      expect(() => db.exec('DELETE FROM respondents WHERE id=42')).toThrow();
      expect(db.prepare('SELECT * FROM respondents').all()).toEqual(before);
      const saved = await backupDatabase(
        db,
        join(root, 'backups'),
        'olive-test',
      );
      const copy = new DatabaseSync(saved, { readOnly: true });
      try {
        expect(
          copy.prepare('SELECT global_user_id FROM legacy_user_mappings').get()
            ?.global_user_id,
        ).toBe('global-stable-id');
      } finally {
        copy.close();
      }
      expect(rollbackLast(db, migrations)).toBe('001-identity-links');
      expect(db.prepare('SELECT * FROM respondents').all()).toEqual(before);
      expect(migrationStatus(db, migrations).applied).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('rolls back an entire failed migration and detects changed migration history', () => {
    const db = new DatabaseSync(':memory:');
    const good: Migration = {
      id: '001',
      up: 'CREATE TABLE answers (id INTEGER)',
      down: 'DROP TABLE answers',
    };
    try {
      expect(() =>
        migrate(db, [good, { id: '002', up: 'INVALID SQL', down: '' }]),
      ).toThrow();
      expect(
        db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all(),
      ).toEqual([]);
      migrate(db, [good]);
      expect(() =>
        migrate(db, [{ ...good, up: `${good.up}; SELECT 1` }]),
      ).toThrow(/historie/);
      expect(migrationStatus(db, [good]).applied).toEqual(['001']);
    } finally {
      db.close();
    }
  });
});
