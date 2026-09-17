const {
  pool
} = require('../db/pool.js');

const {
  roomsForOccupancy
} = require('../utils/occupancy.js');

const {
  newId
} = require('../utils/id.js');

// Optional lunch/dinner add-on — same 6-column shape as fd_packages (see
// 0045_package_requests_meals.sql / fdPackages.model.js's FD_COLUMNS). Kept
// as one small helper so the value list isn't repeated across
// createPackageRequest/createDraftPackageRequest/updateDraftTripInfo below.
function mealValues({ lunchMealId, lunchPeople, lunchDays, dinnerMealId, dinnerPeople, dinnerDays } = {}) {
  return [lunchMealId || null, lunchPeople ?? null, lunchDays ?? null, dinnerMealId || null, dinnerPeople ?? null, dinnerDays ?? null];
}

// Optional Visa add-on (see 0052_package_request_visa.sql) — a checkbox plus
// an adults-only headcount, no catalog entry to pick. Same small-helper shape
// as mealValues above.
function visaValues({ visaEnabled, visaPeople } = {}) {
  return [!!visaEnabled, visaPeople ?? null];
}

async function createPackageRequest(
  client,
  {
    agencyId, createdByUserId, destination, dateFrom, dateTo, paxAdults, paxChildren, ...addOnFields
  }
) {
  const id = newId();
  await client.query(
    `INSERT INTO package_requests
      (id, agency_id, created_by_user_id, destination, date_from, date_to, pax_adults, pax_children, status,
       lunch_meal_id, lunch_people, lunch_days, dinner_meal_id, dinner_people, dinner_days,
       visa_enabled, visa_people)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, agencyId, createdByUserId, destination, dateFrom, dateTo, paxAdults, paxChildren, ...mealValues(addOnFields), ...visaValues(addOnFields)]
  );
  const { rows } = await client.query('SELECT * FROM package_requests WHERE id = ?', [id]);
  return rows[0];
}

module.exports.createPackageRequest = createPackageRequest;

async function addHotelSelections(client, packageRequestId, hotelIds) {
  for (const hotelId of hotelIds) {
    await client.query(
      `INSERT INTO package_request_hotels (id, package_request_id, hotel_id) VALUES (?, ?, ?)`,
      [newId(), packageRequestId, hotelId]
    );
  }
}

module.exports.addHotelSelections = addHotelSelections;

async function addTourSelections(client, packageRequestId, tourIds) {
  for (const tourId of tourIds) {
    await client.query(
      `INSERT INTO package_request_tours (id, package_request_id, tour_id) VALUES (?, ?, ?)`,
      [newId(), packageRequestId, tourId]
    );
  }
}

module.exports.addTourSelections = addTourSelections;

async function addTransferSelections(client, packageRequestId, transferIds) {
  for (const transferId of transferIds) {
    await client.query(
      `INSERT INTO package_request_transfers (id, package_request_id, transfer_id) VALUES (?, ?, ?)`,
      [newId(), packageRequestId, transferId]
    );
  }
}

module.exports.addTransferSelections = addTransferSelections;

async function addActivitySelections(client, packageRequestId, activityIds) {
  for (const activityId of activityIds) {
    await client.query(
      `INSERT INTO package_request_activities (id, package_request_id, activity_id) VALUES (?, ?, ?)`,
      [newId(), packageRequestId, activityId]
    );
  }
}

module.exports.addActivitySelections = addActivitySelections;

async function addTravelers(client, packageRequestId, travelers) {
  for (const traveler of travelers) {
    await client.query(
      `INSERT INTO package_request_travelers (id, package_request_id, name, passport_no, dob, room_share_group, is_child)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        newId(),
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

module.exports.addTravelers = addTravelers;

async function findPackageRequestById(id) {
  const { rows } = await pool.query(`SELECT * FROM package_requests WHERE id = ?`, [id]);
  return rows[0] || null;
}

module.exports.findPackageRequestById = findPackageRequestById;

async function listPackageRequestsForAgency(agencyId) {
  const { rows } = await pool.query(
    `SELECT pr.*, lm.full_name AS lead_manager_full_name, lm.email AS lead_manager_email,
            lm.phone AS lead_manager_phone, lm.whatsapp_number AS lead_manager_whatsapp
     FROM package_requests pr
     LEFT JOIN users lm ON lm.id = pr.lead_manager_user_id
     WHERE pr.agency_id = ?
     ORDER BY pr.updated_at DESC`,
    [agencyId]
  );
  return rows;
}

module.exports.listPackageRequestsForAgency = listPackageRequestsForAgency;

async function findPackageRequestWithLeadManager(id) {
  const { rows } = await pool.query(
    `SELECT pr.*, lm.full_name AS lead_manager_full_name, lm.email AS lead_manager_email,
            lm.phone AS lead_manager_phone, lm.whatsapp_number AS lead_manager_whatsapp
     FROM package_requests pr
     LEFT JOIN users lm ON lm.id = pr.lead_manager_user_id
     WHERE pr.id = ?`,
    [id]
  );
  return rows[0] || null;
}

module.exports.findPackageRequestWithLeadManager = findPackageRequestWithLeadManager;

async function createDraftPackageRequest(
  client,
  { agencyId, createdByUserId, destination, dateFrom, dateTo, paxAdults, paxChildren, ...addOnFields }
) {
  const id = newId();
  await client.query(
    `INSERT INTO package_requests
      (id, agency_id, created_by_user_id, destination, date_from, date_to, pax_adults, pax_children, status,
       lunch_meal_id, lunch_people, lunch_days, dinner_meal_id, dinner_people, dinner_days,
       visa_enabled, visa_people)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, agencyId, createdByUserId, destination || '', dateFrom || null, dateTo || null, paxAdults ?? 1, paxChildren ?? 0, ...mealValues(addOnFields), ...visaValues(addOnFields)]
  );
  const { rows } = await client.query('SELECT * FROM package_requests WHERE id = ?', [id]);
  return rows[0];
}

module.exports.createDraftPackageRequest = createDraftPackageRequest;

async function updateDraftTripInfo(
  client,
  id,
  { destination, dateFrom, dateTo, paxAdults, paxChildren, ...addOnFields }
) {
  const { rowCount } = await client.query(
    `UPDATE package_requests
     SET destination = ?, date_from = ?, date_to = ?, pax_adults = ?, pax_children = ?,
         lunch_meal_id = ?, lunch_people = ?, lunch_days = ?, dinner_meal_id = ?, dinner_people = ?, dinner_days = ?,
         visa_enabled = ?, visa_people = ?,
         updated_at = now()
     WHERE id = ? AND status = 'draft'`,
    [destination || '', dateFrom || null, dateTo || null, paxAdults ?? 1, paxChildren ?? 0, ...mealValues(addOnFields), ...visaValues(addOnFields), id]
  );
  if (!rowCount) return null;
  const { rows } = await client.query('SELECT * FROM package_requests WHERE id = ?', [id]);
  return rows[0] || null;
}

module.exports.updateDraftTripInfo = updateDraftTripInfo;

async function replaceHotelSelections(client, packageRequestId, hotelIds) {
  await client.query(`DELETE FROM package_request_hotels WHERE package_request_id = ?`, [packageRequestId]);
  await addHotelSelections(client, packageRequestId, hotelIds);
}

module.exports.replaceHotelSelections = replaceHotelSelections;

async function replaceTourSelections(client, packageRequestId, tourIds) {
  await client.query(`DELETE FROM package_request_tours WHERE package_request_id = ?`, [packageRequestId]);
  await addTourSelections(client, packageRequestId, tourIds);
}

module.exports.replaceTourSelections = replaceTourSelections;

async function replaceTransferSelections(client, packageRequestId, transferIds) {
  await client.query(`DELETE FROM package_request_transfers WHERE package_request_id = ?`, [packageRequestId]);
  await addTransferSelections(client, packageRequestId, transferIds);
}

module.exports.replaceTransferSelections = replaceTransferSelections;

async function replaceActivitySelections(client, packageRequestId, activityIds) {
  await client.query(`DELETE FROM package_request_activities WHERE package_request_id = ?`, [packageRequestId]);
  await addActivitySelections(client, packageRequestId, activityIds);
}

module.exports.replaceActivitySelections = replaceActivitySelections;

async function replaceTravelers(client, packageRequestId, travelers) {
  await client.query(`DELETE FROM package_request_travelers WHERE package_request_id = ?`, [packageRequestId]);
  await addTravelers(client, packageRequestId, travelers);
}

module.exports.replaceTravelers = replaceTravelers;

async function submitDraftPackageRequest(client, id) {
  const { rowCount } = await client.query(
    `UPDATE package_requests SET status = 'submitted', updated_at = now() WHERE id = ? AND status = 'draft'`,
    [id]
  );
  if (!rowCount) return null;
  const { rows } = await client.query('SELECT * FROM package_requests WHERE id = ?', [id]);
  return rows[0] || null;
}

module.exports.submitDraftPackageRequest = submitDraftPackageRequest;

async function deleteDraftPackageRequest(id) {
  const { rowCount } = await pool.query(`DELETE FROM package_requests WHERE id = ? AND status = 'draft'`, [id]);
  return rowCount > 0;
}

module.exports.deleteDraftPackageRequest = deleteDraftPackageRequest;

async function respondToPackageRequest(id, nextStatus) {
  const { rowCount } = await pool.query(
    `UPDATE package_requests SET status = ?, updated_at = now() WHERE id = ? AND status = 'published'`,
    [nextStatus, id]
  );
  if (!rowCount) return null;
  const { rows } = await pool.query('SELECT * FROM package_requests WHERE id = ?', [id]);
  return rows[0] || null;
}

module.exports.respondToPackageRequest = respondToPackageRequest;

async function listHotelsForRequest(packageRequestId) {
  const { rows } = await pool.query(
    `SELECT h.* FROM package_request_hotels prh
     JOIN hotels h ON h.id = prh.hotel_id
     WHERE prh.package_request_id = ?`,
    [packageRequestId]
  );
  return rows;
}

module.exports.listHotelsForRequest = listHotelsForRequest;

async function listToursForRequest(packageRequestId) {
  const { rows } = await pool.query(
    `SELECT t.* FROM package_request_tours prt
     JOIN tours t ON t.id = prt.tour_id
     WHERE prt.package_request_id = ?`,
    [packageRequestId]
  );
  return rows;
}

module.exports.listToursForRequest = listToursForRequest;

async function listTransfersForRequest(packageRequestId) {
  const { rows } = await pool.query(
    `SELECT tr.* FROM package_request_transfers prt
     JOIN transfers tr ON tr.id = prt.transfer_id
     WHERE prt.package_request_id = ?`,
    [packageRequestId]
  );
  return rows;
}

module.exports.listTransfersForRequest = listTransfersForRequest;

async function listActivitiesForRequest(packageRequestId) {
  const { rows } = await pool.query(
    `SELECT a.* FROM package_request_activities pra
     JOIN activities a ON a.id = pra.activity_id
     WHERE pra.package_request_id = ?`,
    [packageRequestId]
  );
  return rows;
}

module.exports.listActivitiesForRequest = listActivitiesForRequest;

async function listTravelersForRequest(packageRequestId) {
  const { rows } = await pool.query(
    `SELECT * FROM package_request_travelers WHERE package_request_id = ? ORDER BY id`,
    [packageRequestId]
  );
  return rows;
}

module.exports.listTravelersForRequest = listTravelersForRequest;

async function listItineraryForRequest(packageRequestId) {
  const [{ rows: days }, { rows: items }] = await Promise.all([
    pool.query(
      `SELECT * FROM package_request_itinerary_days WHERE package_request_id = ? ORDER BY day_number`,
      [packageRequestId]
    ),
    pool.query(
      `SELECT * FROM package_request_itinerary_items WHERE package_request_id = ? ORDER BY day_number, position`,
      [packageRequestId]
    ),
  ]);
  return { days, items };
}

module.exports.listItineraryForRequest = listItineraryForRequest;

async function replaceItinerary(client, packageRequestId, days) {
  await client.query(`DELETE FROM package_request_itinerary_days WHERE package_request_id = ?`, [packageRequestId]);
  await client.query(`DELETE FROM package_request_itinerary_items WHERE package_request_id = ?`, [packageRequestId]);

  for (const day of days || []) {
    await client.query(
      `INSERT INTO package_request_itinerary_days (id, package_request_id, day_number, notes) VALUES (?, ?, ?, ?)`,
      [newId(), packageRequestId, day.dayNumber, day.notes || null]
    );
    for (const [position, item] of (day.items || []).entries()) {
      await client.query(
        `INSERT INTO package_request_itinerary_items (id, package_request_id, day_number, item_type, item_id, position, note, occupancy)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [newId(), packageRequestId, day.dayNumber, item.type, item.id, position, item.note || null, item.occupancy || null]
      );
    }
  }
}

module.exports.replaceItinerary = replaceItinerary;

function composeItinerary(days, items, pools, totalAdults) {
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

module.exports.composeItinerary = composeItinerary;
