import 'server-only';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { projectIdSchema } from '../projects/project.ts';

export type ProjectDatabase = Readonly<{
  id: string;
  /** Only application configuration can supply this; never HTTP input. */
  existingPath?: string;
}>;

export function databasePath(
  project: ProjectDatabase,
  root = process.cwd(),
): string {
  const id = projectIdSchema.parse(project.id);
  return resolve(root, project.existingPath ?? `data/projects/${id}.sqlite`);
}

export function openProjectDatabase(
  project: ProjectDatabase,
  options: { root?: string; create?: boolean; readOnly?: boolean } = {},
): DatabaseSync {
  const path = databasePath(project, options.root);
  if (!existsSync(path) && !options.create)
    throw new Error(
      `Datenbank fehlt: ${project.id}. Explizite Initialisierung erforderlich.`,
    );
  if (options.create) mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path, {
    readOnly: options.readOnly ?? false,
    enableForeignKeyConstraints: true,
    timeout: 5000,
  });
  return db;
}

export function assertIntegrity(db: DatabaseSync): void {
  const result = db.prepare('PRAGMA integrity_check').all();
  if (result.length !== 1 || result[0]?.integrity_check !== 'ok')
    throw new Error('SQLite-Integritätsprüfung fehlgeschlagen.');
  if (db.prepare('PRAGMA foreign_key_check').all().length)
    throw new Error('SQLite-Fremdschlüsselprüfung fehlgeschlagen.');
}
