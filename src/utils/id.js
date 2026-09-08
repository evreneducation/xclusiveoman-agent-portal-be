import { randomUUID } from 'node:crypto';

// MySQL has no gen_random_uuid()-as-default equivalent (unlike the Postgres
// schema this replaced, where every id UUID PRIMARY KEY had a DB-side
// default) — every INSERT now generates its own id here before writing it.
export function newId() {
  return randomUUID();
}
