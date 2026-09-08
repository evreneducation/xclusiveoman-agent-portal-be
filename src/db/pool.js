import mysql from 'mysql2/promise';
import { env } from '../config/env.js';

// mysql2 returns [rows, fields] and connections don't have the same method
// names as pg's. Every model/controller/service in this codebase was written
// against pg's `{ rows, rowCount }` result shape and `pool.connect()` ->
// client with `.query()`/`.release()`, so this module wraps a real mysql2
// pool to keep that same shape — the ~40 files calling
// `const { rows } = await pool.query(...)` or running manual
// BEGIN/COMMIT/ROLLBACK transactions via `pool.connect()` didn't need to
// change their destructuring or transaction control flow, only the SQL text
// itself (placeholders, RETURNING, etc.).
const rawPool = mysql.createPool({
  uri: env.databaseUrl,
});

rawPool.on('error', (err) => {
  console.error('Unexpected MySQL pool error', err);
});

// For a SELECT, mysql2's query() resolves the first tuple element to a plain
// array of row objects. For INSERT/UPDATE/DELETE it instead resolves to one
// ResultSetHeader object (affectedRows/insertId/...), not an array — pg
// always returns `rows` (an array, empty for a write without RETURNING) and
// `rowCount` (a number) regardless of statement type, so this normalizes
// mysql2's two different shapes into that same one.
function normalize(result) {
  if (Array.isArray(result)) {
    return { rows: result, rowCount: result.length };
  }
  return { rows: [], rowCount: result.affectedRows, insertId: result.insertId };
}

export const pool = {
  async query(text, params) {
    const [result] = await rawPool.query(text, params);
    return normalize(result);
  },
  async connect() {
    const conn = await rawPool.getConnection();
    return {
      async query(text, params) {
        const [result] = await conn.query(text, params);
        return normalize(result);
      },
      release() {
        conn.release();
      },
    };
  },
  async end() {
    await rawPool.end();
  },
};

export async function query(text, params) {
  return pool.query(text, params);
}
