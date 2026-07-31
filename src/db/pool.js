import pg from 'pg';
import { env } from '../config/env.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.databaseUrl,
});

pool.on('error', (err) => {
  // Unexpected errors on idle clients shouldn't crash the process silently unnoticed.
  console.error('Unexpected PostgreSQL pool error', err);
});

export async function query(text, params) {
  return pool.query(text, params);
}
