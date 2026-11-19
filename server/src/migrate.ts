// Tiny in-repo migration runner: numbered .sql files, each applied once, each in its own transaction.
// Chosen over an external tool so the exact same files run against Postgres and against PGlite in tests.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './db.js';

// MIGRATIONS_DIR lets the bundled Vercel function find the SQL files it ships next to itself.
const defaultDir = process.env.MIGRATIONS_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations');

export async function migrate(db: Db, dir: string = defaultDir): Promise<string[]> {
  await db.query(`create table if not exists schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`);
  const files = fs.readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  const applied: string[] = [];
  for (const file of files) {
    const done = await db.query('select 1 from schema_migrations where name = $1', [file]);
    if (done.rowCount > 0) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await db.transaction(async (tx) => {
      await tx.query(sql);
      await tx.query('insert into schema_migrations (name) values ($1)', [file]);
    });
    applied.push(file);
  }
  return applied;
}
