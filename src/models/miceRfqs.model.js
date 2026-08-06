import { pool } from '../db/pool.js';

// Mirrors packageRequests.model.js's shape (insert helpers take an explicit
// `client` so the whole submission commits atomically — see
// miceRfqs.controller.js#create). Read helpers below are reused as-is by
// the admin controller (miceRfqsAdmin.controller.js), same pattern as
// package_requests' read helpers.

export async function createMiceRfq(client, {
  agencyId, createdByUserId, destination, groupSize, eventDateFrom, eventDateTo,
  hallCapacityNeeded, seatingStyle, avNeeds, otherRequirements,
}) {
  const { rows } = await client.query(
    `INSERT INTO mice_rfqs
      (agency_id, created_by_user_id, destination, group_size, event_date_from, event_date_to,
       hall_capacity_needed, seating_style, av_needs, other_requirements, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'submitted')
     RETURNING *`,
    [
      agencyId,
      createdByUserId,
      destination,
      groupSize,
      eventDateFrom,
      eventDateTo,
      hallCapacityNeeded || null,
      seatingStyle || null,
      avNeeds || null,
      otherRequirements || null,
    ]
  );
  return rows[0];
}

export async function addHotelSelections(client, miceRfqId, hotelIds) {
  for (const hotelId of hotelIds) {
    await client.query(`INSERT INTO mice_rfq_hotels (mice_rfq_id, hotel_id) VALUES ($1, $2)`, [miceRfqId, hotelId]);
  }
}

export async function addTourSelections(client, miceRfqId, tourIds) {
  for (const tourId of tourIds) {
    await client.query(`INSERT INTO mice_rfq_tours (mice_rfq_id, tour_id) VALUES ($1, $2)`, [miceRfqId, tourId]);
  }
}

export async function addTransferSelections(client, miceRfqId, transferIds) {
  for (const transferId of transferIds) {
    await client.query(`INSERT INTO mice_rfq_transfers (mice_rfq_id, transfer_id) VALUES ($1, $2)`, [miceRfqId, transferId]);
  }
}

export async function addActivitySelections(client, miceRfqId, activityIds) {
  for (const activityId of activityIds) {
    await client.query(`INSERT INTO mice_rfq_activities (mice_rfq_id, activity_id) VALUES ($1, $2)`, [miceRfqId, activityId]);
  }
}

export async function findMiceRfqById(id) {
  const { rows } = await pool.query(`SELECT * FROM mice_rfqs WHERE id = $1`, [id]);
  return rows[0] || null;
}

// --- Agent MICE Request & Proposal Workflow (My MICE Requests) ---
// Everything below is additive — the functions above are still used as-is by
// both this controller and the admin one, unchanged.

// "My MICE Requests" list (items 1/2/3) — every request the agent's own
// agency has, draft or otherwise. lead_manager_* mirrors the same join the
// admin side already uses (REL-4: lead manager visible once assigned).
export async function listMiceRfqsForAgency(agencyId) {
  const { rows } = await pool.query(
    `SELECT mr.*, lm.full_name AS lead_manager_full_name, lm.email AS lead_manager_email,
            lm.phone AS lead_manager_phone, lm.whatsapp_number AS lead_manager_whatsapp
     FROM mice_rfqs mr
     LEFT JOIN users lm ON lm.id = mr.lead_manager_user_id
     WHERE mr.agency_id = $1
     ORDER BY mr.updated_at DESC`,
    [agencyId]
  );
  return rows;
}

export async function findMiceRfqWithLeadManager(id) {
  const { rows } = await pool.query(
    `SELECT mr.*, lm.full_name AS lead_manager_full_name, lm.email AS lead_manager_email,
            lm.phone AS lead_manager_phone, lm.whatsapp_number AS lead_manager_whatsapp
     FROM mice_rfqs mr
     LEFT JOIN users lm ON lm.id = mr.lead_manager_user_id
     WHERE mr.id = $1`,
    [id]
  );
  return rows[0] || null;
}

// Item 1 — "Save Draft". Trip fields are optional/blank-friendly (validated
// leniently by draftMiceRfqSchema, not the strict submit schema). Takes
// `client` like createMiceRfq above — the row plus its selections are
// written as one transaction by the controller.
export async function createDraftMiceRfq(client, {
  agencyId, createdByUserId, destination, groupSize, eventDateFrom, eventDateTo,
  hallCapacityNeeded, seatingStyle, avNeeds, otherRequirements,
}) {
  const { rows } = await client.query(
    `INSERT INTO mice_rfqs
      (agency_id, created_by_user_id, destination, group_size, event_date_from, event_date_to,
       hall_capacity_needed, seating_style, av_needs, other_requirements, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'draft')
     RETURNING *`,
    [
      agencyId,
      createdByUserId,
      destination || '',
      groupSize || null,
      eventDateFrom || null,
      eventDateTo || null,
      hallCapacityNeeded || null,
      seatingStyle || null,
      avNeeds || null,
      otherRequirements || null,
    ]
  );
  return rows[0];
}

// "Continue Editing" autosave — only ever touches a row still in 'draft'
// (WHERE guard), so a submitted request can never be silently rewritten by
// a stale builder tab.
export async function updateDraftMiceRfqInfo(client, id, {
  destination, groupSize, eventDateFrom, eventDateTo, hallCapacityNeeded, seatingStyle, avNeeds, otherRequirements,
}) {
  const { rows } = await client.query(
    `UPDATE mice_rfqs
     SET destination = $1, group_size = $2, event_date_from = $3, event_date_to = $4,
         hall_capacity_needed = $5, seating_style = $6, av_needs = $7, other_requirements = $8, updated_at = now()
     WHERE id = $9 AND status = 'draft'
     RETURNING *`,
    [
      destination || '',
      groupSize || null,
      eventDateFrom || null,
      eventDateTo || null,
      hallCapacityNeeded || null,
      seatingStyle || null,
      avNeeds || null,
      otherRequirements || null,
      id,
    ]
  );
  return rows[0] || null;
}

// Re-saving a draft always sends the builder's *current* full selection, so
// each selection type is cleared and reinserted rather than diffed — same
// "always send full state" shape as package_requests' draft replace helpers.
export async function replaceHotelSelections(client, miceRfqId, hotelIds) {
  await client.query(`DELETE FROM mice_rfq_hotels WHERE mice_rfq_id = $1`, [miceRfqId]);
  await addHotelSelections(client, miceRfqId, hotelIds);
}

export async function replaceTourSelections(client, miceRfqId, tourIds) {
  await client.query(`DELETE FROM mice_rfq_tours WHERE mice_rfq_id = $1`, [miceRfqId]);
  await addTourSelections(client, miceRfqId, tourIds);
}

export async function replaceTransferSelections(client, miceRfqId, transferIds) {
  await client.query(`DELETE FROM mice_rfq_transfers WHERE mice_rfq_id = $1`, [miceRfqId]);
  await addTransferSelections(client, miceRfqId, transferIds);
}

export async function replaceActivitySelections(client, miceRfqId, activityIds) {
  await client.query(`DELETE FROM mice_rfq_activities WHERE mice_rfq_id = $1`, [miceRfqId]);
  await addActivitySelections(client, miceRfqId, activityIds);
}

// "Submit Draft" — flips draft -> submitted; guarded to only ever fire from
// 'draft' so it can't resubmit an already-submitted request.
export async function submitDraftMiceRfq(client, id) {
  const { rows } = await client.query(
    `UPDATE mice_rfqs SET status = 'submitted', updated_at = now() WHERE id = $1 AND status = 'draft' RETURNING *`,
    [id]
  );
  return rows[0] || null;
}

// "Delete Draft" — scoped to status = 'draft' so a submitted/costed/published
// request can never be deleted through this path.
export async function deleteDraftMiceRfq(id) {
  const { rowCount } = await pool.query(`DELETE FROM mice_rfqs WHERE id = $1 AND status = 'draft'`, [id]);
  return rowCount > 0;
}

// Item 5 — Accept / Request Revision / Decline. Guarded to only ever fire
// from 'published', matching "When the proposal status is Published".
export async function respondToMiceRfq(id, nextStatus) {
  const { rows } = await pool.query(
    `UPDATE mice_rfqs SET status = $1, updated_at = now() WHERE id = $2 AND status = 'published' RETURNING *`,
    [nextStatus, id]
  );
  return rows[0] || null;
}

export async function listHotelsForRfq(miceRfqId) {
  const { rows } = await pool.query(
    `SELECT h.* FROM mice_rfq_hotels mh JOIN hotels h ON h.id = mh.hotel_id WHERE mh.mice_rfq_id = $1`,
    [miceRfqId]
  );
  return rows;
}

export async function listToursForRfq(miceRfqId) {
  const { rows } = await pool.query(
    `SELECT t.* FROM mice_rfq_tours mt JOIN tours t ON t.id = mt.tour_id WHERE mt.mice_rfq_id = $1`,
    [miceRfqId]
  );
  return rows;
}

export async function listTransfersForRfq(miceRfqId) {
  const { rows } = await pool.query(
    `SELECT tr.* FROM mice_rfq_transfers mt JOIN transfers tr ON tr.id = mt.transfer_id WHERE mt.mice_rfq_id = $1`,
    [miceRfqId]
  );
  return rows;
}

export async function listActivitiesForRfq(miceRfqId) {
  const { rows } = await pool.query(
    `SELECT a.* FROM mice_rfq_activities ma JOIN activities a ON a.id = ma.activity_id WHERE ma.mice_rfq_id = $1`,
    [miceRfqId]
  );
  return rows;
}
