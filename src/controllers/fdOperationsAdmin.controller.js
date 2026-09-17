const {
  listDeparturesWithOperationsState,
  findDepartureWithOperationsState,
  computeStageInfo,
  isBookingConfirmed,
  getOrCreateOperations,
  advanceStage: advanceStageModel,
  insertDriverDispatchAndAdvanceStage,
  listPaxManifest,
  listDepartureAgencyIds,
  insertSupplierLog,
  listSupplierLogs,
  listDriverDispatches,
  insertTourUpdate,
  listTourUpdates
} = require('../models/fdOperations.model.js');

const {
  insertAuditLog,
  listAuditLogsForEntity
} = require('../models/auditLogs.model.js');

const {
  notifyDriverDispatched,
  notifyTourUpdatePublished
} = require('../services/fdOperationsNotify.service.js');

// Admin FD Operations Tracker (Task 12 — Screen 19). FD-only (requirement
// I4) — every read/write here goes through fdOperations.model.js, which
// itself only ever touches bookings where source_type = 'fd_package'.

const STAGE_LABELS = {
  docs_collected: 'Documents Collected',
  supplier_coordination: 'Supplier Coordination',
  visa_processing: 'Visa Processing',
  driver_sent: 'Driver / Pickup Sent',
  trip_live: 'Trip Live',
  completed: 'Completed / Review',
};

function toPublicDepartureSummary(row) {
  const { currentStage } = computeStageInfo(row);
  return {
    departureDateId: row.departure_date_id,
    date: row.date,
    location: row.location,
    fdPackageId: row.fd_package_id,
    packageTitle: row.package_title,
    paxTotal: row.pax_total,
    agencyCount: row.agency_count,
    currentStage,
  };
}

function toPublicDepartureDetail(row) {
  const { stages, currentStage } = computeStageInfo(row);
  return {
    departureDateId: row.departure_date_id,
    date: row.date,
    location: row.location,
    fdPackageId: row.fd_package_id,
    packageTitle: row.package_title,
    heroImageUrl: row.hero_image_url,
    paxTotal: row.pax_total,
    agencyCount: row.agency_count,
    currentStage,
    stages,
  };
}

function toPublicManifestRow(row) {
  return {
    bookingId: row.id,
    pax: row.pax,
    status: row.status,
    totalPrice: Number(row.total_price),
    depositPaid: Number(row.deposit_paid),
    balanceDue: Number(row.balance_due),
    createdAt: row.created_at,
    agencyId: row.agency_id,
    agencyName: row.agency_name,
    createdByName: row.created_by_name,
    createdByEmail: row.created_by_email,
    // Name + room-sharing only — never passport_no/dob (see
    // fdOperations.model.js#listPaxManifest's own comment).
    travelers: row.travelers.map((t) => ({ name: t.name, roomShareGroup: t.room_share_group })),
  };
}

function toPublicSupplierLog(row) {
  return {
    id: row.id,
    supplierName: row.supplier_name,
    item: row.item,
    status: row.status,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
  };
}

function toPublicDriverDispatch(row) {
  return {
    id: row.id,
    driverName: row.driver_name,
    vehicle: row.vehicle,
    pickupDetails: row.pickup_details,
    sentByName: row.sent_by_name,
    sentAt: row.sent_at,
  };
}

function toPublicTourUpdate(row) {
  return {
    id: row.id,
    updateType: row.update_type,
    message: row.message,
    publishedByName: row.published_by_name,
    publishedAt: row.published_at,
  };
}

// Merges the four real event sources (stage-change audit logs + the three
// action tables) into one chronological feed — never a separate, duplicated
// "activity" table: each source already durably records itself, this just
// reads all four back together (requirement: Operations Detail's own
// Activity History).
function buildActivityHistory({ stageAuditLogs, supplierLogs, driverDispatches, tourUpdates }) {
  const items = [];
  for (const log of stageAuditLogs) {
    items.push({
      type: 'stage',
      description: `Stage advanced — ${STAGE_LABELS[log.field] || log.field}`,
      at: log.created_at,
      by: log.actor_full_name || null,
    });
  }
  for (const log of supplierLogs) {
    items.push({
      type: 'supplier_log',
      description: `Supplier logged — ${log.supplier_name}: ${log.item} (${log.status})`,
      at: log.created_at,
      by: log.created_by_name,
    });
  }
  for (const d of driverDispatches) {
    items.push({
      type: 'driver_dispatch',
      description: `Driver & pickup sent — ${d.driver_name} (${d.vehicle})`,
      at: d.sent_at,
      by: d.sent_by_name,
    });
  }
  for (const t of tourUpdates) {
    items.push({
      type: 'tour_update',
      description: `Tour update published — ${t.update_type.replace(/_/g, ' ')}`,
      at: t.published_at,
      by: t.published_by_name,
    });
  }
  return items.sort((a, b) => new Date(b.at) - new Date(a.at));
}

async function listDepartures(req, res, next) {
  try {
    const { search, stage, page, pageSize } = req.query;
    const rows = await listDeparturesWithOperationsState({ search });
    let items = rows.map(toPublicDepartureSummary);

    if (stage) {
      items = items.filter((d) => d.currentStage === stage);
    }

    const total = items.length;
    const limit = Math.max(1, Math.min(100, Number(pageSize) || 20));
    const currentPage = Math.max(1, Number(page) || 1);
    const offset = (currentPage - 1) * limit;

    res.json({
      departures: items.slice(offset, offset + limit),
      pagination: { total, page: currentPage, pageSize: limit, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (err) {
    next(err);
  }
}

module.exports.listDepartures = listDepartures;

async function getDepartureDetail(req, res, next) {
  try {
    const { departureDateId } = req.params;
    const row = await findDepartureWithOperationsState(departureDateId);
    if (!row) return res.status(404).json({ error: 'not_found' });

    const [manifest, supplierLogs, driverDispatches, tourUpdates, stageAuditLogs] = await Promise.all([
      listPaxManifest(departureDateId),
      listSupplierLogs(departureDateId),
      listDriverDispatches(departureDateId),
      listTourUpdates(departureDateId),
      row.operations_id ? listAuditLogsForEntity('fd_departure_operations', row.operations_id) : Promise.resolve([]),
    ]);

    res.json({
      departure: toPublicDepartureDetail(row),
      manifest: manifest.map(toPublicManifestRow),
      supplierLogs: supplierLogs.map(toPublicSupplierLog),
      driverDispatches: driverDispatches.map(toPublicDriverDispatch),
      tourUpdates: tourUpdates.map(toPublicTourUpdate),
      activity: buildActivityHistory({ stageAuditLogs, supplierLogs, driverDispatches, tourUpdates }),
    });
  } catch (err) {
    next(err);
  }
}

module.exports.getDepartureDetail = getDepartureDetail;

async function advanceStage(req, res, next) {
  try {
    const { departureDateId } = req.params;
    const { stage } = req.body;

    const departure = await findDepartureWithOperationsState(departureDateId);
    if (!departure) return res.status(404).json({ error: 'not_found' });

    if (!isBookingConfirmed(departure)) {
      return res.status(400).json({
        error: 'booking_not_confirmed',
        message: 'At least one booking on this departure must be confirmed or fully paid before operational stages can begin.',
      });
    }

    const operations = await getOrCreateOperations(departureDateId);
    const result = await advanceStageModel(operations.id, stage);

    if (!result.ok) {
      if (result.reason === 'already_complete') {
        return res.status(409).json({ error: 'already_complete', message: `"${STAGE_LABELS[stage]}" has already been marked complete.` });
      }
      if (result.reason === 'prerequisite_incomplete') {
        return res.status(409).json({
          error: 'prerequisite_incomplete',
          message: `Complete "${STAGE_LABELS[result.missingStage] || result.missingStage}" before "${STAGE_LABELS[stage]}".`,
        });
      }
      return res.status(404).json({ error: 'not_found' });
    }

    // Requirement: "Record audit entries for stage changes" — the one
    // event type this task writes to audit_logs directly (supplier logs/
    // driver dispatches/tour updates are their own durable records already,
    // read back together for Activity History above, not duplicated here).
    await insertAuditLog({
      actorUserId: req.user.id,
      entity: 'fd_departure_operations',
      entityId: operations.id,
      field: stage,
      newValue: { stage },
    });

    const merged = { ...departure, ...result.operations };
    res.json(toPublicDepartureDetail(merged));
  } catch (err) {
    next(err);
  }
}

module.exports.advanceStage = advanceStage;

async function addSupplierLog(req, res, next) {
  try {
    const { departureDateId } = req.params;
    const departure = await findDepartureWithOperationsState(departureDateId);
    if (!departure) return res.status(404).json({ error: 'not_found' });

    const { supplierName, item, status } = req.body;
    const log = await insertSupplierLog(departureDateId, { supplierName, item, status, createdByUserId: req.user.id });

    res.status(201).json({
      supplierLog: toPublicSupplierLog({ ...log, created_by_name: req.user.full_name }),
    });
  } catch (err) {
    next(err);
  }
}

module.exports.addSupplierLog = addSupplierLog;

async function dispatchDriver(req, res, next) {
  try {
    const { departureDateId } = req.params;
    const departure = await findDepartureWithOperationsState(departureDateId);
    if (!departure) return res.status(404).json({ error: 'not_found' });

    if (!isBookingConfirmed(departure)) {
      return res.status(400).json({
        error: 'booking_not_confirmed',
        message: 'At least one booking on this departure must be confirmed or fully paid before operational stages can begin.',
      });
    }

    const operations = await getOrCreateOperations(departureDateId);
    const priorStages = ['docs_collected', 'supplier_coordination', 'visa_processing'];
    const missingPrereq = priorStages.find((s) => !operations[`${s}_at`]);
    if (missingPrereq) {
      return res.status(409).json({
        error: 'prerequisite_incomplete',
        message: `Complete "${STAGE_LABELS[missingPrereq]}" before sending driver & pickup details.`,
      });
    }

    const { driverName, vehicle, pickupDetails } = req.body;
    const { dispatch, operations: updatedOperations } = await insertDriverDispatchAndAdvanceStage(departureDateId, operations.id, {
      driverName,
      vehicle,
      pickupDetails,
      sentByUserId: req.user.id,
    });

    // Only writes an audit entry the first time this actually advances the
    // stage (driver_sent_at was previously null) — a resend after the
    // stage already advanced still creates a real dispatch record and
    // still notifies agencies (below), it just isn't a second "stage
    // advanced" audit event for a stage that was already done.
    if (!operations.driver_sent_at) {
      await insertAuditLog({
        actorUserId: req.user.id,
        entity: 'fd_departure_operations',
        entityId: operations.id,
        field: 'driver_sent',
        newValue: { stage: 'driver_sent' },
      });
    }

    await notifyDriverDispatched(departureDateId, {
      packageTitle: departure.package_title,
      driverName,
      vehicle,
      pickupDetails,
    });

    const merged = { ...departure, ...updatedOperations };
    res.status(201).json({
      dispatch: toPublicDriverDispatch({ ...dispatch, sent_by_name: req.user.full_name }),
      departure: toPublicDepartureDetail(merged),
    });
  } catch (err) {
    next(err);
  }
}

module.exports.dispatchDriver = dispatchDriver;

async function publishTourUpdate(req, res, next) {
  try {
    const { departureDateId } = req.params;
    const departure = await findDepartureWithOperationsState(departureDateId);
    if (!departure) return res.status(404).json({ error: 'not_found' });

    const { updateType, message } = req.body;
    const update = await insertTourUpdate(departureDateId, { updateType, message, publishedByUserId: req.user.id });

    await notifyTourUpdatePublished(departureDateId, { packageTitle: departure.package_title, updateType, message });

    res.status(201).json({
      tourUpdate: toPublicTourUpdate({ ...update, published_by_name: req.user.full_name }),
    });
  } catch (err) {
    next(err);
  }
}

module.exports.publishTourUpdate = publishTourUpdate;
module.exports.listDepartureAgencyIds = listDepartureAgencyIds;
