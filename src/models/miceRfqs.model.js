const {
  pool
} = require('../db/pool.js');

const {
  newId
} = require('../utils/id.js');

async function createMiceRfq(
  client,
  {
    agencyId, createdByUserId, destination, groupSize, eventDateFrom, eventDateTo,
    hallCapacityNeeded, seatingStyle, avNeeds, otherRequirements,
  }
) {
  const id = newId();
  await client.query(
    `INSERT INTO mice_rfqs
      (id, agency_id, created_by_user_id, destination, group_size, event_date_from, event_date_to,
       hall_capacity_needed, seating_style, av_needs, other_requirements, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted')`,
    [
      id,
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
  const { rows } = await client.query('SELECT * FROM mice_rfqs WHERE id = ?', [id]);
  return rows[0];
}

module.exports.createMiceRfq = createMiceRfq;

async function addHotelSelections(client, miceRfqId, hotelIds) {
  for (const hotelId of hotelIds) {
    await client.query(`INSERT INTO mice_rfq_hotels (id, mice_rfq_id, hotel_id) VALUES (?, ?, ?)`, [newId(), miceRfqId, hotelId]);
  }
}

module.exports.addHotelSelections = addHotelSelections;

async function addTourSelections(client, miceRfqId, tourIds) {
  for (const tourId of tourIds) {
    await client.query(`INSERT INTO mice_rfq_tours (id, mice_rfq_id, tour_id) VALUES (?, ?, ?)`, [newId(), miceRfqId, tourId]);
  }
}

module.exports.addTourSelections = addTourSelections;

async function addTransferSelections(client, miceRfqId, transferIds) {
  for (const transferId of transferIds) {
    await client.query(`INSERT INTO mice_rfq_transfers (id, mice_rfq_id, transfer_id) VALUES (?, ?, ?)`, [newId(), miceRfqId, transferId]);
  }
}

module.exports.addTransferSelections = addTransferSelections;

async function addActivitySelections(client, miceRfqId, activityIds) {
  for (const activityId of activityIds) {
    await client.query(`INSERT INTO mice_rfq_activities (id, mice_rfq_id, activity_id) VALUES (?, ?, ?)`, [newId(), miceRfqId, activityId]);
  }
}

module.exports.addActivitySelections = addActivitySelections;

async function findMiceRfqById(id) {
  const { rows } = await pool.query(`SELECT * FROM mice_rfqs WHERE id = ?`, [id]);
  return rows[0] || null;
}

module.exports.findMiceRfqById = findMiceRfqById;

async function listMiceRfqsForAgency(agencyId) {
  const { rows } = await pool.query(
    `SELECT mr.*, lm.full_name AS lead_manager_full_name, lm.email AS lead_manager_email,
            lm.phone AS lead_manager_phone, lm.whatsapp_number AS lead_manager_whatsapp
     FROM mice_rfqs mr
     LEFT JOIN users lm ON lm.id = mr.lead_manager_user_id
     WHERE mr.agency_id = ?
     ORDER BY mr.updated_at DESC`,
    [agencyId]
  );
  return rows;
}

module.exports.listMiceRfqsForAgency = listMiceRfqsForAgency;

async function findMiceRfqWithLeadManager(id) {
  const { rows } = await pool.query(
    `SELECT mr.*, lm.full_name AS lead_manager_full_name, lm.email AS lead_manager_email,
            lm.phone AS lead_manager_phone, lm.whatsapp_number AS lead_manager_whatsapp
     FROM mice_rfqs mr
     LEFT JOIN users lm ON lm.id = mr.lead_manager_user_id
     WHERE mr.id = ?`,
    [id]
  );
  return rows[0] || null;
}

module.exports.findMiceRfqWithLeadManager = findMiceRfqWithLeadManager;

async function createDraftMiceRfq(
  client,
  {
    agencyId, createdByUserId, destination, groupSize, eventDateFrom, eventDateTo,
    hallCapacityNeeded, seatingStyle, avNeeds, otherRequirements,
  }
) {
  const id = newId();
  await client.query(
    `INSERT INTO mice_rfqs
      (id, agency_id, created_by_user_id, destination, group_size, event_date_from, event_date_to,
       hall_capacity_needed, seating_style, av_needs, other_requirements, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
    [
      id,
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
  const { rows } = await client.query('SELECT * FROM mice_rfqs WHERE id = ?', [id]);
  return rows[0];
}

module.exports.createDraftMiceRfq = createDraftMiceRfq;

async function updateDraftMiceRfqInfo(
  client,
  id,
  {
    destination, groupSize, eventDateFrom, eventDateTo, hallCapacityNeeded, seatingStyle, avNeeds, otherRequirements,
  }
) {
  const { rowCount } = await client.query(
    `UPDATE mice_rfqs
     SET destination = ?, group_size = ?, event_date_from = ?, event_date_to = ?,
         hall_capacity_needed = ?, seating_style = ?, av_needs = ?, other_requirements = ?, updated_at = now()
     WHERE id = ? AND status = 'draft'`,
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
  if (!rowCount) return null;
  const { rows } = await client.query('SELECT * FROM mice_rfqs WHERE id = ?', [id]);
  return rows[0] || null;
}

module.exports.updateDraftMiceRfqInfo = updateDraftMiceRfqInfo;

async function replaceHotelSelections(client, miceRfqId, hotelIds) {
  await client.query(`DELETE FROM mice_rfq_hotels WHERE mice_rfq_id = ?`, [miceRfqId]);
  await addHotelSelections(client, miceRfqId, hotelIds);
}

module.exports.replaceHotelSelections = replaceHotelSelections;

async function replaceTourSelections(client, miceRfqId, tourIds) {
  await client.query(`DELETE FROM mice_rfq_tours WHERE mice_rfq_id = ?`, [miceRfqId]);
  await addTourSelections(client, miceRfqId, tourIds);
}

module.exports.replaceTourSelections = replaceTourSelections;

async function replaceTransferSelections(client, miceRfqId, transferIds) {
  await client.query(`DELETE FROM mice_rfq_transfers WHERE mice_rfq_id = ?`, [miceRfqId]);
  await addTransferSelections(client, miceRfqId, transferIds);
}

module.exports.replaceTransferSelections = replaceTransferSelections;

async function replaceActivitySelections(client, miceRfqId, activityIds) {
  await client.query(`DELETE FROM mice_rfq_activities WHERE mice_rfq_id = ?`, [miceRfqId]);
  await addActivitySelections(client, miceRfqId, activityIds);
}

module.exports.replaceActivitySelections = replaceActivitySelections;

async function submitDraftMiceRfq(client, id) {
  const { rowCount } = await client.query(
    `UPDATE mice_rfqs SET status = 'submitted', updated_at = now() WHERE id = ? AND status = 'draft'`,
    [id]
  );
  if (!rowCount) return null;
  const { rows } = await client.query('SELECT * FROM mice_rfqs WHERE id = ?', [id]);
  return rows[0] || null;
}

module.exports.submitDraftMiceRfq = submitDraftMiceRfq;

async function deleteDraftMiceRfq(id) {
  const { rowCount } = await pool.query(`DELETE FROM mice_rfqs WHERE id = ? AND status = 'draft'`, [id]);
  return rowCount > 0;
}

module.exports.deleteDraftMiceRfq = deleteDraftMiceRfq;

async function respondToMiceRfq(id, nextStatus) {
  const { rowCount } = await pool.query(
    `UPDATE mice_rfqs SET status = ?, updated_at = now() WHERE id = ? AND status = 'published'`,
    [nextStatus, id]
  );
  if (!rowCount) return null;
  const { rows } = await pool.query('SELECT * FROM mice_rfqs WHERE id = ?', [id]);
  return rows[0] || null;
}

module.exports.respondToMiceRfq = respondToMiceRfq;

async function listItineraryForRfq(miceRfqId) {
  const [{ rows: days }, { rows: items }] = await Promise.all([
    pool.query(`SELECT * FROM mice_rfq_itinerary_days WHERE mice_rfq_id = ? ORDER BY day_number`, [miceRfqId]),
    pool.query(
      `SELECT * FROM mice_rfq_itinerary_items WHERE mice_rfq_id = ? ORDER BY day_number, position`,
      [miceRfqId]
    ),
  ]);
  return { days, items };
}

module.exports.listItineraryForRfq = listItineraryForRfq;

async function replaceItinerary(client, miceRfqId, days) {
  await client.query(`DELETE FROM mice_rfq_itinerary_days WHERE mice_rfq_id = ?`, [miceRfqId]);
  await client.query(`DELETE FROM mice_rfq_itinerary_items WHERE mice_rfq_id = ?`, [miceRfqId]);

  for (const day of days || []) {
    await client.query(
      `INSERT INTO mice_rfq_itinerary_days (id, mice_rfq_id, day_number, notes) VALUES (?, ?, ?, ?)`,
      [newId(), miceRfqId, day.dayNumber, day.notes || null]
    );
    for (const [position, item] of (day.items || []).entries()) {
      await client.query(
        `INSERT INTO mice_rfq_itinerary_items (id, mice_rfq_id, day_number, item_type, item_id, position, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [newId(), miceRfqId, day.dayNumber, item.type, item.id, position, item.note || null]
      );
    }
  }
}

module.exports.replaceItinerary = replaceItinerary;

function composeItinerary(days, items, pools) {
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
    });
  }
  return [...byDay.values()].sort((a, b) => a.dayNumber - b.dayNumber);
}

module.exports.composeItinerary = composeItinerary;

async function listHotelsForRfq(miceRfqId) {
  const { rows } = await pool.query(
    `SELECT h.* FROM mice_rfq_hotels mh JOIN hotels h ON h.id = mh.hotel_id WHERE mh.mice_rfq_id = ?`,
    [miceRfqId]
  );
  return rows;
}

module.exports.listHotelsForRfq = listHotelsForRfq;

async function listToursForRfq(miceRfqId) {
  const { rows } = await pool.query(
    `SELECT t.* FROM mice_rfq_tours mt JOIN tours t ON t.id = mt.tour_id WHERE mt.mice_rfq_id = ?`,
    [miceRfqId]
  );
  return rows;
}

module.exports.listToursForRfq = listToursForRfq;

async function listTransfersForRfq(miceRfqId) {
  const { rows } = await pool.query(
    `SELECT tr.* FROM mice_rfq_transfers mt JOIN transfers tr ON tr.id = mt.transfer_id WHERE mt.mice_rfq_id = ?`,
    [miceRfqId]
  );
  return rows;
}

module.exports.listTransfersForRfq = listTransfersForRfq;

async function listActivitiesForRfq(miceRfqId) {
  const { rows } = await pool.query(
    `SELECT a.* FROM mice_rfq_activities ma JOIN activities a ON a.id = ma.activity_id WHERE ma.mice_rfq_id = ?`,
    [miceRfqId]
  );
  return rows;
}

module.exports.listActivitiesForRfq = listActivitiesForRfq;
