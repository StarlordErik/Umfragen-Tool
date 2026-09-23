import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { z } from 'zod';
import {
  oliveDatabase,
  oliveMigrations,
} from '../src/projects/olive-symposium/data/database.ts';
import {
  assertIntegrity,
  openProjectDatabase,
} from '../src/shared/db/project-database.ts';
import {
  backupDatabase,
  migrate,
  migrationStatus,
  rollbackLast,
} from '../src/shared/db/migrations.ts';

if (existsSync('.env')) loadEnvFile('.env');
const command = z
  .enum(['status', 'check', 'backup', 'migrate', 'rollback'])
  .parse(process.argv[2] ?? 'status');
const project = z
  .enum(['olive-symposium'])
  .parse(process.argv[3] ?? 'olive-symposium');
const definition = oliveDatabase();
const migrations = oliveMigrations();
const db = openProjectDatabase(definition, {
  readOnly: ['status', 'check', 'backup'].includes(command),
});
try {
  assertIntegrity(db);
  if (command === 'status') {
    const status = migrationStatus(db, migrations);
    console.log({
      project,
      applied: status.applied,
      pending: status.pending.map((item) => item.id),
    });
  } else if (command === 'check')
    console.log(`${project}: Integrität und Fremdschlüssel OK.`);
  else {
    const target = await backupDatabase(db, resolve('data/backups'), project);
    console.log(`Geprüftes Backup: ${target}`);
    if (command === 'migrate')
      console.log('Angewandt:', migrate(db, migrations));
    if (command === 'rollback')
      console.log(
        'Zurückgenommen:',
        rollbackLast(db, migrations) ?? 'keine Migration',
      );
  }
} finally {
  db.close();
}
