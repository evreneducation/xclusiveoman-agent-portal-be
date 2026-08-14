import { pool } from '../db/pool.js';
import { roomsForOccupancy } from '../utils/occupancy.js';

// Optional lunch/dinner add-on — same 6-column shape as fd_packages (see
// 0045_package_requests_meals.sql / fdPackages.model.js's FD_COLUMNS). Kept
// as one small helper so the value list isn't repeated across
// createPackageRequest/createDraftPackageRequest/updateDraftTripInfo below.
function mealValues({ lunchMealId, lunchPeople, lunchDays, dinnerMealId, dinnerPeople, dinnerDays } = {}) {
  return [lunchMealId || null, lunchPeople ?? null, lunchDays ?? null, dinnerMealId || null, dinnerPeople ?? null, dinnerDays ?? null];
}

// Package Inclusions (see 0047_package_request_inclusions.sql) — stored as
// one JSONB object, `{ items, dismissedKeys }`. `undefined`/missing input
// (e.g. an older client that doesn't send this yet) is normalized to the
// empty shape rather than nulling out a value that was already saved would —
// callers always pass the builder's full current state, same as itinerary.
function inclusionsValue(inclusions) {
  return JSON.stringify(inclusions || { items: [], dismissedKeys: [] });
}

// Insert helpers take an explicit `client` so the whole submission (request +
// all selections + travelers) commits atomically as one transaction — see
// packageRequests.controller.js#create.

export async function createPackageRequest(client, {
  agencyId, createdByUserId, destination, dateFrom, dateTo, paxAdults, paxChildren, inclusions, ...mealFields
}) {
  const { rows } = await client.query(
    `INSERT INTO package_requests
      (agency_id, created_by_user_id, destination, date_from, date_to, pax_adults, pax_children, status,
       lunch_meal_id, lunch_people, lunch_days, dinner_meal_id, dinner_people, dinner_days, inclusions)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'submitted', $8, $9, $10, $11, $12, $13, $14)
     RETURNING *`,
    [agencyId, createdByUserId, destination, dateFrom, dateTo, paxAdults, paxChildren, ...mealValues(mealFields), inclusionsValue(inclusions)]
  );
  return rows[0];
}

export async function addHotelSelections(client, packageRequestId, hotelIds) {
  for (const hotelId of hotelIds) {
    await client.query(
      `INSERT INTO package_request_hotels (package_request_id, hotel_id) VALUES ($1, $2)`,
      [packageRequestId, hotelId]
    );
  }
}

export async function addTourSelections(client, packageRequestId, tourIds) {
  for (const tourId of tourIds) {
    await client.query(
      `INSERT INTO package_request_tours (package_request_id, tour_id) VALUES ($1, $2)`,
      [packageRequestId, tourId]
    );
  }
}

export async function addTransferSelections(client, packageRequestId, transferIds) {
  for (const transferId of transferIds) {
    await client.query(
      `INSERT INTO package_request_transfers (package_request_id, transfer_id) VALUES ($1, $2)`,
      [packageRequestId, transferId]
    );
  }
}

export async function addActivitySelections(client, packageRequestId, activityIds) {
  for (const activityId of activityIds) {
    await client.query(
      `INSERT INTO package_request_activities (package_request_id, activity_id) VALUES ($1, $2)`,
      [packageRequestId, activityId]
    );
  }
}

export async function addTravelers(client, packageRequestId, travelers) {
  for (const traveler of travelers) {
    await client.query(
      `INSERT INTO package_request_travelers (package_request_id, name, passport_no, dob, room_share_group, is_child)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        packageRequestId,
        traveler.name,
        traveler.passportNo || null,
        traveler.dob || null,
        traveler.roomShareGroup || null,
        !!traveler.isChild,
      ]
    );
  }
}

export async function findPackageRequestById(id) {
  const { rows } = await pool.query(`SELECT * FROM package_requests WHERE id = $1`, [id]);
  return rows[0] || null;
}

// --- Agent Quote lifecycle (My FIT Requests / Quotes) ---
// Everything below is additive — the functions above are still used as-is by
// both this controller and the admin one, unchanged.

// "My FIT Requests / Quotes" list (item 2/8) — every request the agent's own
// agency has, draft or otherwise. lead_manager_* mirrors the same join the
// admin side already uses (REL-4: lead manager visible once assigned).
export async function listPackageRequestsForAgency(agencyId) {
  const { rows } = await pool.query(
    `SELECT pr.*, lm.full_name AS lead_manager_full_name, lm.email AS lead_manager_email,
            lm.phone AS lead_manager_phone, lm.whatsapp_number AS lead_manager_whatsapp
     FROM package_requests pr
     LEFT JOIN users lm ON lm.id = pr.lead_manager_user_id
     WHERE pr.agency_id = $1
     ORDER BY pr.updated_at DESC`,
    [agencyId]
  );
  return rows;
}

export async function findPackageRequestWithLeadManager(id) {
  const { rows } = await pool.query(
    `SELECT pr.*, lm.full_name AS lead_manager_full_name, lm.email AS lead_manager_email,
            lm.phone AS lead_manager_phone, lm.whatsapp_number AS lead_manager_whatsapp
     FROM package_requests pr
     LEFT JOIN users lm ON lm.id = pr.lead_manager_user_id
     WHERE pr.id = $1`,
    [id]
  );
  return rows[0] || null;
}

// Item 1 — "Save Draft". Trip fields are optional/blank-friendly (validated
// leniently by draftPackageRequestSchema, not the strict submit schema).
// Takes `client` like createPackageRequest above — the row plus its
// selections/travelers are written as one transaction by the controller.
export async function createDraftPackageRequest(client, { agencyId, createdByUserId, destination, dateFrom, dateTo, paxAdults, paxChildren, inclusions, ...mealFields }) {
  const { rows } = await client.query(
    `INSERT INTO package_requests
      (agency_id, created_by_user_id, destination, date_from, date_to, pax_adults, pax_children, status,
       lunch_meal_id, lunch_people, lunch_days, dinner_meal_id, dinner_people, dinner_days, inclusions)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', $8, $9, $10, $11, $12, $13, $14)
     RETURNING *`,
    [agencyId, createdByUserId, destination || '', dateFrom || null, dateTo || null, paxAdults ?? 1, paxChildren ?? 0, ...mealValues(mealFields), inclusionsValue(inclusions)]
  );
  return rows[0];
}

// "Continue Editing" autosave — only ever touches a row still in 'draft'
// (WHERE guard), so a submitted request can never be silently rewritten by
// a stale builder tab.
export async function updateDraftTripInfo(client, id, { destination, dateFrom, dateTo, paxAdults, paxChildren, inclusions, ...mealFields }) {
  const { rows } = await client.query(
    `UPDATE package_requests
     SET destination = $1, date_from = $2, date_to = $3, pax_adults = $4, pax_children = $5,
         lunch_meal_id = $6, lunch_people = $7, lunch_days = $8, dinner_meal_id = $9, dinner_people = $10, dinner_days = $11,
         inclusions = $12, updated_at = now()
     WHERE id = $13 AND status = 'draft'
     RETURNING *`,
    [destination || '', dateFrom || null, dateTo || null, paxAdults ?? 1, paxChildren ?? 0, ...mealValues(mealFields), inclusionsValue(inclusions), id]
  );
  return rows[0] || null;
}

// Re-saving a draft always sends the builder's *current* full selection, so
// each selection type is cleared and reinserted rather than diffed — same
// "always send full state" shape as the admin costing save.
export async function replaceHotelSelections(client, packageRequestId, hotelIds) {
  await client.query(`DELETE FROM package_request_hotels WHERE package_request_id = $1`, [packageRequestId]);
  await addHotelSelections(client, packageRequestId, hotelIds);
}

export async function replaceTourSelections(client, packageRequestId, tourIds) {
  await client.query(`DELETE FROM package_request_tours WHERE package_request_id = $1`, [packageRequestId]);
  await addTourSelections(client, packageRequestId, tourIds);
}

export async function replaceTransferSelections(client, packageRequestId, transferIds) {
  await client.query(`DELETE FROM package_request_transfers WHERE package_request_id = $1`, [packageRequestId]);
  await addTransferSelections(client, packageRequestId, transferIds);
}

export async function replaceActivitySelections(client, packageRequestId, activityIds) {
  await client.query(`DELETE FROM package_request_activities WHERE package_request_id = $1`, [packageRequestId]);
  await addActivitySelections(client, packageRequestId, activityIds);
}

export async function replaceTravelers(client, packageRequestId, travelers) {
  await client.query(`DELETE FROM package_request_travelers WHERE package_request_id = $1`, [packageRequestId]);
  await addTravelers(client, packageRequestId, travelers);
}

// "Submit Draft once completed" — flips draft -> submitted; guarded to only
// ever fire from 'draft' so it can't resubmit an already-submitted request.
export async function submitDraftPackageRequest(client, id) {
  const { rows } = await client.query(
    `UPDATE package_requests SET status = 'submitted', updated_at = now() WHERE id = $1 AND status = 'draft' RETURNING *`,
    [id]
  );
  return rows[0] || null;
}

// "Delete Draft" — scoped to status = 'draft' so a submitted/priced/published
// request can never be deleted through this path.
export async function deleteDraftPackageRequest(id) {
  const { rowCount } = await pool.query(`DELETE FROM package_requests WHERE id = $1 AND status = 'draft'`, [id]);
  return rowCount > 0;
}

// Item 5 — Accept / Request Revision / Decline. Guarded to only ever fire
// from 'published', matching "If the quote status is Published" in the doc.
export async function respondToPackageRequest(id, nextStatus) {
  const { rows } = await pool.query(
    `UPDATE package_requests SET status = $1, updated_at = now() WHERE id = $2 AND status = 'published' RETURNING *`,
    [nextStatus, id]
  );
  return rows[0] || null;
}

export async function listHotelsForRequest(packageRequestId) {
  const { rows } = await pool.query(
    `SELECT h.* FROM package_request_hotels prh
     JOIN hotels h ON h.id = prh.hotel_id
     WHERE prh.package_request_id = $1`,
    [packageRequestId]
  );
  return rows;
}

export async function listToursForRequest(packageRequestId) {
  const { rows } = await pool.query(
    `SELECT t.* FROM package_request_tours prt
     JOIN tours t ON t.id = prt.tour_id
     WHERE prt.package_request_id = $1`,
    [packageRequestId]
  );
  return rows;
}

export async function listTransfersForRequest(packageRequestId) {
  const { rows } = await pool.query(
    `SELECT tr.* FROM package_request_transfers prt
     JOIN transfers tr ON tr.id = prt.transfer_id
     WHERE prt.package_request_id = $1`,
    [packageRequestId]
  );
  return rows;
}

export async function listActivitiesForRequest(packageRequestId) {
  const { rows } = await pool.query(
    `SELECT a.* FROM package_request_activities pra
     JOIN activities a ON a.id = pra.activity_id
     WHERE pra.package_request_id = $1`,
    [packageRequestId]
  );
  return rows;
}

export async function listTravelersForRequest(packageRequestId) {
  const { rows } = await pool.query(
    `SELECT * FROM package_request_travelers WHERE package_request_id = $1 ORDER BY id`,
    [packageRequestId]
  );
  return rows;
}

// --- Day-wise Itinerary Planner (FIT-5) ---
// Days are virtual (Day 1..N derived from date_from/date_to by the caller) —
// only a day's notes and its assigned items persist, and only for days that
// actually have something on them. Read together (days + items) since every
// consumer (agent serializer, admin serializer, the itinerary editor's own
// GET-through-detail) needs both to reconstruct the day cards.
export async function listItineraryForRequest(packageRequestId) {
  const [{ rows: days }, { rows: items }] = await Promise.all([
    pool.query(
      `SELECT * FROM package_request_itinerary_days WHERE package_request_id = $1 ORDER BY day_number`,
      [packageRequestId]
    ),
    pool.query(
      `SELECT * FROM package_request_itinerary_items WHERE package_request_id = $1 ORDER BY day_number, position`,
      [packageRequestId]
    ),
  ]);
  return { days, items };
}

// Same "always send full state, clear and reinsert" shape as
// replaceHotelSelections etc. above — the builder/editor always PUTs its
// complete current arrangement, so there's nothing to diff. Takes an
// explicit `client` like the other replace* functions so it can join the
// same transaction as the rest of a create/draft-save/submit.
//
// `days` shape: [{ dayNumber, notes, items: [{ type, id, note?, occupancy? }] }]
// — position within a day is each item's index in its `items` array. `note`
// is a short per-item annotation, distinct from the day's own `notes`.
// `occupancy` ('single'/'double'/'triple' — how the trip's known headcount,
// pax_adults, splits into rooms) is only meaningful on 'hotel' items — see
// computeHotelCostAuto in packageRequestsAdmin.controller.js.
export async function replaceItinerary(client, packageRequestId, days) {
  await client.query(`DELETE FROM package_request_itinerary_days WHERE package_request_id = $1`, [packageRequestId]);
  await client.query(`DELETE FROM package_request_itinerary_items WHERE package_request_id = $1`, [packageRequestId]);

  for (const day of days || []) {
    await client.query(
      `INSERT INTO package_request_itinerary_days (package_request_id, day_number, notes) VALUES ($1, $2, $3)`,
      [packageRequestId, day.dayNumber, day.notes || null]
    );
    for (const [position, item] of (day.items || []).entries()) {
      await client.query(
        `INSERT INTO package_request_itinerary_items (package_request_id, day_number, item_type, item_id, position, note, occupancy)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [packageRequestId, day.dayNumber, item.type, item.id, position, item.note || null, item.occupancy || null]
      );
    }
  }
}

// Composes the persisted days/items rows into the [{dayNumber, notes, items:
// [{type, id, name, ...}]}] shape both serializers return, enriching each
// item against the pools of already-fetched, already-mapped catalog rows
// (hotels/tours/transfers/activities) rather than re-querying — those pools
// differ slightly between the agent and admin serializers (admin's include
// prices), so the enriched item picks up whatever fields that pool already has.
// `totalAdults` (package_requests.pax_adults) is only needed to derive each
// hotel item's `rooms` for display — callers that don't care can omit it.
export function composeItinerary(days, items, pools, totalAdults) {
  const byDay = new Map();
  for (const d of days) {
    byDay.set(d.day_number, { dayNumber: d.day_number, notes: d.notes || '', items: [] });
  }
  for (const it of items) {
    if (!byDay.has(it.day_number)) {
      byDay.set(it.day_number, { dayNumber: it.day_number, notes: '', items: [] });
    }
    const pool = pools[it.item_type] || [];
    const ref = pool.find((p) => p.id === it.item_id);
    byDay.get(it.day_number).items.push({
      type: it.item_type,
      id: it.item_id,
      name: ref?.name || null,
      city: ref?.city ?? null,
      images: ref?.images ?? undefined,
      note: it.note || '',
      // Occupancy — hotel items only (undefined for everything else). `rooms`
      // is the derived room count (computeHotelCostAuto's pricing driver in
      // packageRequestsAdmin.controller.js) so consumers don't need to
      // re-derive ceil(pax_adults / capacity) themselves just to display it.
      ...(it.item_type === 'hotel' ? { occupancy: it.occupancy ?? null, rooms: roomsForOccupancy(totalAdults, it.occupancy) } : {}),
    });
  }
  return [...byDay.values()].sort((a, b) => a.dayNumber - b.dayNumber);
}

// Normalizes package_requests.inclusions (JSONB, parsed to a JS object by
// pg — null for a request created before 0047_package_request_inclusions.sql
// or one that's never had a line added) into the always-present
// `{ items, dismissedKeys }` shape both serializers return.
export function composeInclusions(row) {
  const raw = row.inclusions;
  return {
    items: Array.isArray(raw?.items) ? raw.items : [],
    dismissedKeys: Array.isArray(raw?.dismissedKeys) ? raw.dismissedKeys : [],
  };
}
