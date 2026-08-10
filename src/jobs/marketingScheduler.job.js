import cron from 'node-cron';
import { pool } from '../db/pool.js';
import { executeCampaignSend } from '../services/marketingSend.service.js';

// Marketing Center Task 6 — Schedule Campaign. `node-cron` was already a
// package.json dependency (added for this feature, apparently, since
// nothing in the codebase used it before this file) — reused rather than
// adding a new scheduling library.
//
// This polls the database every minute rather than using a single
// in-memory setTimeout/setInterval per scheduled campaign: the source of
// truth for "what's due" is always the `marketing_campaigns` row itself
// (`status = 'scheduled'`, `scheduled_at`), never a timer living only in
// process memory — so a server restart loses nothing. The next tick after
// a restart just picks up anything still due, exactly as it would have
// anyway.

// Atomically claims every campaign whose scheduled_at has passed, flipping
// each straight to 'sending' in the same statement that selects them —
// `FOR UPDATE SKIP LOCKED` means an overlapping tick (or, if this process
// is ever scaled beyond one instance) can't claim the same row twice, so a
// campaign is never sent by two workers at once.
async function claimDueCampaigns(client) {
  const { rows } = await client.query(`
    UPDATE marketing_campaigns
    SET status = 'sending', updated_at = now()
    WHERE id IN (
      SELECT id FROM marketing_campaigns
      WHERE status = 'scheduled' AND scheduled_at <= now()
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `);
  return rows.map((r) => r.id);
}

// In-process guard only — stops this same worker from starting a second
// pass while a big batch from the previous minute is still sending.
// FOR UPDATE SKIP LOCKED above is the real (multi-process-safe) guarantee;
// this just avoids redundant claim queries in the common single-process case.
let running = false;

export async function runDueCampaigns() {
  if (running) return;
  running = true;
  try {
    const client = await pool.connect();
    let ids = [];
    try {
      await client.query('BEGIN');
      ids = await claimDueCampaigns(client);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[marketingScheduler] Failed to claim due campaigns', err);
    } finally {
      client.release();
    }

    for (const id of ids) {
      try {
        // Same send logic Send Campaign uses (services/marketingSend.service.js)
        // — provider-not-configured, per-recipient failure, and the
        // sent/partially_failed/failed rollup all behave identically here.
        await executeCampaignSend(id);
      } catch (err) {
        // One campaign failing to execute never blocks the others in this
        // batch, and never crashes the scheduler itself.
        console.error(`[marketingScheduler] Campaign ${id} failed to send`, err);
      }
    }
  } finally {
    running = false;
  }
}

// Scheduling granularity is "to the minute" (the Compose UI's time input
// has no seconds), so a 60s poll is exactly as precise as the feature
// needs — not an arbitrary number.
export function startMarketingScheduler() {
  cron.schedule('* * * * *', () => {
    runDueCampaigns().catch((err) => console.error('[marketingScheduler] Unexpected error', err));
  });
}
