import { pool } from '../db/pool.js';

// Insert helpers take an explicit `client` so the whole submission (request +
// all selections + travelers) commits atomically as one transaction — see
// packageRequests.controller.js#create.

export async function createPackageRequest(client, {
  agencyId, createdByUserId, destination, dateFrom, dateTo, paxAdults, paxChildren,
}) {
  const { rows } = await client.query(
    `INSERT INTO package_requests
      (agency_id, created_by_user_id, destination, date_from, date_to, pax_adults, pax_children, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'submitted')
     RETURNING *`,
    [agencyId, createdByUserId, destination, dateFrom, dateTo, paxAdults, paxChildren]
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
      `INSERT INTO package_request_travelers (package_request_id, name, passport_no, dob, room_share_group)
       VALUES ($1, $2, $3, $4, $5)`,
      [packageRequestId, traveler.name, traveler.passportNo || null, traveler.dob || null, traveler.roomShareGroup || null]
    );
  }
}

export async function findPackageRequestById(id) {
  const { rows } = await pool.query(`SELECT * FROM package_requests WHERE id = $1`, [id]);
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
