import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { env } from '../config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, '..', '..', 'migrations');

async function ensureMigrationsTable(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function run() {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  // multipleStatements is scoped to this one dedicated connection (each
  // migration file is several ;-separated DDL statements) rather than the
  // app's shared pool.js pool, to keep that pool's normal query surface from
  // ever accepting more than one statement per call.
  const conn = await mysql.createConnection({
    uri: env.databaseUrl,
    multipleStatements: true,
  });
  try {
    await ensureMigrationsTable(conn);

    const [rows] = await conn.query('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.name));

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`skip  ${file} (already applied)`);
        continue;
      }

      const sql = readFileSync(path.join(migrationsDir, file), 'utf8');
      console.log(`apply ${file}`);

      // MySQL DDL auto-commits per statement (no transactional DDL like
      // Postgres), so there's no BEGIN/ROLLBACK safety net here — a
      // migration that fails partway leaves the schema in whatever state
      // its earlier statements left it in. Keep migration files small and
      // ordered for that reason.
      try {
        await conn.query(sql);
        await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
      } catch (err) {
        throw new Error(`Migration ${file} failed (schema may be partially applied): ${err.message}`);
      }
    }

    console.log('Migrations up to date.');
  } finally {
    await conn.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
