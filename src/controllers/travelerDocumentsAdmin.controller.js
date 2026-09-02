import { findBookingDetailForAdmin } from '../models/bookingsAdmin.model.js';
import {
  listTravelersWithDocuments,
  findTravelerInBooking,
  findTravelerDocumentsByTravelerId,
  saveAdminVisaCopy,
  upsertBookingVoucher,
  findVoucherByBookingId,
  markDocumentsNotified,
} from '../models/documents.model.js';
import { listAgencyOwnerEmails } from '../models/users.model.js';
import { insertAuditLog } from '../models/auditLogs.model.js';
import { uploadBuffer } from '../services/cloudinary.service.js';
import { streamDocumentsZip, fetchDocumentBuffer, extFromUrl } from '../services/documentZip.service.js';
import { createNotification } from '../services/notification.service.js';
import { sendEmail } from '../services/email.service.js';
import { getIo } from '../sockets/index.js';

// Admin Booking & Visa Processing (Task 14 — Screen 23, DOC-2..6). Mounted
// into the existing bookingsAdmin.routes.js router (same
// requireAuth/requireRole('ops_admin','super_admin') gate Task 13 already
// established — this file adds handlers, not a new RBAC boundary).
//
// DOC-6's original design gated every admin-uploaded document (visa copy,
// voucher) behind a separate, manual "Notify Agent" click before an agent
// could see or download it — see travelerDocumentsAgent.controller.js's own
// history. That manual release step is gone: uploadVisaCopy/uploadVoucher
// below now unlock immediately (travelerDocumentsAgent.controller.js no
// longer checks documents_notified_at at all) and fire the one-time
// "documents ready" notification/email themselves via
// notifyAgentDocumentsReadyOnce, the first time anything becomes available
// for a booking — no admin action required, and nothing to forget to click.

const DOC_TYPE_COLUMN = {
  passport_scan: 'passport_scan_url',
  passport_photo: 'passport_photo_url',
  visa_copy: 'visa_copy_url',
};
const DOC_TYPE_LABEL = {
  passport_scan: 'passport scan',
  passport_photo: 'passport photo',
  visa_copy: 'visa copy',
};

function toPublicTravelerDocs(row) {
  return {
    travelerId: row.id,
    name: row.name,
    passportNo: row.passport_no,
    roomShareGroup: row.room_share_group,
    passportScanUploaded: !!row.passport_scan_url,
    passportPhotoUploaded: !!row.passport_photo_url,
    visaCopyUploaded: !!row.visa_copy_url,
    uploadedByAgentAt: row.uploaded_by_agent_at,
    visaUploadedByAdminAt: row.visa_uploaded_by_admin_at,
  };
}

async function loadBookingOr404(req, res) {
  const booking = await findBookingDetailForAdmin(req.params.id);
  if (!booking) {
    res.status(404).json({ error: 'not_found' });
    return null;
  }
  return booking;
}

// GET /api/admin/bookings/:id/documents — DOC-2's "view documents grouped by
// traveler", plus the booking-level voucher and the current unlock state.
export async function getDocuments(req, res, next) {
  try {
    const booking = await loadBookingOr404(req, res);
    if (!booking) return;

    const [travelers, voucher] = await Promise.all([
      listTravelersWithDocuments(booking.id),
      findVoucherByBookingId(booking.id),
    ]);

    res.json({
      booking: {
        id: booking.id,
        agencyId: booking.agency_id,
        agencyName: booking.agency_name,
        packageTitle: booking.package_title,
        departureDate: booking.departure_date,
        departureLocation: booking.departure_location,
        status: booking.status,
        documentsNotifiedAt: booking.documents_notified_at,
      },
      travelers: travelers.map(toPublicTravelerDocs),
      voucher: voucher ? { uploaded: true, uploadedAt: voucher.uploaded_at } : { uploaded: false, uploadedAt: null },
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/admin/bookings/:id/travelers/:travelerId/documents/:type/download
// Admin can always download any existing document — no unlock gate applies
// to admin, only to the agent side (see travelerDocumentsAgent.controller.js).
export async function downloadTravelerDocument(req, res, next) {
  try {
    const { id: bookingId, travelerId, type } = req.params;
    const column = DOC_TYPE_COLUMN[type];
    if (!column) return res.status(400).json({ error: 'invalid_document_type' });

    const booking = await loadBookingOr404(req, res);
    if (!booking) return;

    const traveler = await findTravelerInBooking(travelerId, bookingId);
    if (!traveler) return res.status(404).json({ error: 'traveler_not_found' });

    const docs = await findTravelerDocumentsByTravelerId(travelerId);
    const url = docs?.[column];
    if (!url) return res.status(404).json({ error: 'document_not_found' });

    const buffer = await fetchDocumentBuffer(url);
    await insertAuditLog({
      actorUserId: req.user.id,
      entity: 'booking',
      entityId: bookingId,
      field: 'document_downloaded',
      newValue: { travelerId, type },
    });

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${type}_${traveler.name.replace(/[^a-z0-9]/gi, '_')}.${extFromUrl(url)}"`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
}

// GET /api/admin/bookings/:id/voucher/download
export async function downloadVoucher(req, res, next) {
  try {
    const booking = await loadBookingOr404(req, res);
    if (!booking) return;

    const voucher = await findVoucherByBookingId(booking.id);
    if (!voucher) return res.status(404).json({ error: 'voucher_not_found' });

    const buffer = await fetchDocumentBuffer(voucher.voucher_url);
    await insertAuditLog({
      actorUserId: req.user.id,
      entity: 'booking',
      entityId: booking.id,
      field: 'document_downloaded',
      newValue: { type: 'voucher' },
    });

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="voucher.${extFromUrl(voucher.voucher_url)}"`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
}

// Shared by download-all and email-to-supplier — resolves every currently
// uploaded document for a booking into { path/label, url } entries, using
// the documented Booking_<id>/Traveler_<n>/... folder convention (Phase 5).
async function collectDocumentEntries(bookingId) {
  const travelers = await listTravelersWithDocuments(bookingId);
  const entries = [];
  travelers.forEach((t, i) => {
    const folder = `Traveler_${i + 1}_${t.name.replace(/[^a-z0-9]/gi, '_')}`;
    if (t.passport_scan_url) entries.push({ path: `${folder}/passport_scan.${extFromUrl(t.passport_scan_url)}`, url: t.passport_scan_url, label: `${t.name} — passport scan` });
    if (t.passport_photo_url) entries.push({ path: `${folder}/passport_photo.${extFromUrl(t.passport_photo_url)}`, url: t.passport_photo_url, label: `${t.name} — passport photo` });
    if (t.visa_copy_url) entries.push({ path: `${folder}/visa_copy.${extFromUrl(t.visa_copy_url)}`, url: t.visa_copy_url, label: `${t.name} — visa copy` });
  });
  const voucher = await findVoucherByBookingId(bookingId);
  if (voucher) entries.push({ path: `voucher.${extFromUrl(voucher.voucher_url)}`, url: voucher.voucher_url, label: 'Booking voucher' });
  return entries;
}

// GET /api/admin/bookings/:id/documents/download-all
export async function downloadAllZip(req, res, next) {
  try {
    const booking = await loadBookingOr404(req, res);
    if (!booking) return;

    const entries = await collectDocumentEntries(booking.id);
    if (entries.length === 0) return res.status(404).json({ error: 'no_documents' });

    await insertAuditLog({
      actorUserId: req.user.id,
      entity: 'booking',
      entityId: booking.id,
      field: 'document_downloaded',
      newValue: { type: 'zip', count: entries.length },
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="Booking_${booking.id}.zip"`);
    // entries' own `path` already begins with the Traveler_n folder; prefix
    // with the Booking_<id> folder here so the zip's own internal layout
    // matches the documented Booking_<id>/Traveler_n/... convention exactly.
    await streamDocumentsZip(
      res,
      entries.map((e) => ({ ...e, path: `Booking_${booking.id}/${e.path}` }))
    );
  } catch (err) {
    next(err);
  }
}

// POST /api/admin/bookings/:id/documents/email-to-supplier —
// {to, message, documentRefs: [{type, travelerId?}]} where type is one of
// passport_scan/passport_photo/visa_copy (with travelerId) or voucher
// (booking-level, no travelerId). Reuses email.service.js#sendEmail's
// existing `attachments` support — no second email implementation.
export async function emailToSupplier(req, res, next) {
  try {
    const booking = await loadBookingOr404(req, res);
    if (!booking) return;

    const { to, message, documentRefs } = req.body;
    if (!Array.isArray(documentRefs) || documentRefs.length === 0) {
      return res.status(400).json({ error: 'no_documents_selected' });
    }

    const allEntries = await collectDocumentEntries(booking.id);
    const travelers = await listTravelersWithDocuments(booking.id);
    const travelerNameById = new Map(travelers.map((t) => [t.id, t.name]));

    const selected = [];
    for (const ref of documentRefs) {
      if (ref.type === 'voucher') {
        const found = allEntries.find((e) => e.path.startsWith('voucher.'));
        if (found) selected.push({ ...found, filename: found.path });
        continue;
      }
      const column = DOC_TYPE_COLUMN[ref.type];
      if (!column || !ref.travelerId) continue;
      const traveler = travelers.find((t) => t.id === ref.travelerId);
      if (!traveler || !traveler[column]) continue;
      selected.push({
        url: traveler[column],
        label: `${DOC_TYPE_LABEL[ref.type]} — ${traveler.name}`,
        filename: `${ref.type}_${(travelerNameById.get(ref.travelerId) || 'traveler').replace(/[^a-z0-9]/gi, '_')}.${extFromUrl(traveler[column])}`,
      });
    }

    if (selected.length === 0) {
      return res.status(400).json({ error: 'no_documents_selected', message: 'None of the selected documents exist for this booking.' });
    }

    const attachments = await Promise.all(
      selected.map(async (doc) => ({
        filename: doc.filename || doc.path?.split('/').pop() || 'document',
        content: await fetchDocumentBuffer(doc.url),
      }))
    );

    const subject = `Travel documents — ${booking.package_title} (${booking.agency_name})`;
    const body = message || `Please find attached ${selected.length} document(s) for booking ${booking.id}.`;

    try {
      await sendEmail({ to, subject, text: body, attachments });
    } catch (err) {
      // Explicit failure, not a silent success — Phase 6's own requirement.
      // The documents themselves are untouched either way.
      return res.status(502).json({ error: 'email_failed', message: err.message || 'Unable to send the email. Please try again.' });
    }

    // Audit records which documents were sent and to whom — never the
    // document contents themselves.
    await insertAuditLog({
      actorUserId: req.user.id,
      entity: 'booking',
      entityId: booking.id,
      field: 'documents_emailed_to_supplier',
      newValue: { to, documentCount: selected.length, documents: selected.map((d) => d.label) },
    });

    res.json({ sent: true, to, documentCount: selected.length });
  } catch (err) {
    next(err);
  }
}

// Fires automatically from uploadVisaCopy/uploadVoucher below, replacing the
// old manual "Notify Agent" button (DOC-6) — every admin-uploaded document is
// visible/downloadable to the agent the instant it's saved regardless (see
// travelerDocumentsAgent.controller.js), so this is no longer a gate; it's
// just the one-time "documents ready" in-app notification + email, sent the
// first time *anything* becomes available for a booking so an agent doesn't
// get one email per traveler as visas trickle in. markDocumentsNotified
// itself stays idempotent (COALESCE) and is still called every time, purely
// as the durable "have we sent the one-time notification yet" bookkeeping —
// best-effort fan-out below, same posture as fdOperationsNotify.service.js /
// bookingsAdmin.controller.js#createManualBooking's own notify step.
async function notifyAgentDocumentsReadyOnce(booking, actorUserId) {
  const alreadyNotified = !!booking.documents_notified_at;
  const updated = await markDocumentsNotified(booking.id);
  if (alreadyNotified) return updated;

  await insertAuditLog({
    actorUserId,
    entity: 'booking',
    entityId: booking.id,
    field: 'documents_notified',
    newValue: { documentsNotifiedAt: updated.documents_notified_at, trigger: 'auto' },
  });

  try {
    const [owner] = await listAgencyOwnerEmails([booking.agency_id]);
    if (owner) {
      const message = `Your travel documents for ${booking.package_title} are ready to download.`;
      try {
        await createNotification({
          recipientUserId: owner.id,
          recipientRole: 'agency_owner',
          type: 'documents_ready',
          title: 'Documents ready',
          message,
          referenceType: 'booking',
          referenceId: booking.id,
        });
      } catch (err) {
        console.error(`[travelerDocumentsAdmin] Failed to notify user ${owner.id}`, err);
      }
      try {
        await sendEmail({ to: owner.email, subject: 'Your travel documents are ready — Xclusive Oman', text: message });
      } catch (err) {
        console.error(`[travelerDocumentsAdmin] Failed to email ${owner.email}`, err);
      }
    }
  } catch (err) {
    console.error(`[travelerDocumentsAdmin] Failed to fan out documents-ready notification for booking ${booking.id}`, err);
  }

  return updated;
}

// Live-refreshes an agent who already has this booking's document page open
// (BookingDetail.jsx's own socket listener) — fired on *every* upload, not
// just the first, unlike notifyAgentDocumentsReadyOnce's one-time email/
// in-app notification above; a page refresh isn't spam the way a repeated
// email would be.
function emitBookingDocumentsChanged(booking) {
  getIo()?.to(`agency:${booking.agency_id}`).emit('booking:status_changed', { bookingId: booking.id, status: booking.status });
}

// POST /api/admin/bookings/:id/travelers/:travelerId/visa-copy — DOC-4.
export async function uploadVisaCopy(req, res, next) {
  try {
    const { id: bookingId, travelerId } = req.params;
    const booking = await loadBookingOr404(req, res);
    if (!booking) return;

    const traveler = await findTravelerInBooking(travelerId, bookingId);
    if (!traveler) return res.status(404).json({ error: 'traveler_not_found' });

    if (!req.file) return res.status(400).json({ error: 'missing_file', message: 'Upload the processed visa copy' });

    const upload = await uploadBuffer(req.file.buffer, { folderParts: ['bookings', bookingId, 'travelers', travelerId, 'visa-copy'] });
    const docs = await saveAdminVisaCopy(travelerId, upload.secure_url);

    await insertAuditLog({
      actorUserId: req.user.id,
      entity: 'booking',
      entityId: bookingId,
      field: 'visa_uploaded',
      newValue: { travelerId, travelerName: traveler.name },
    });

    const updated = await notifyAgentDocumentsReadyOnce(booking, req.user.id);
    emitBookingDocumentsChanged(booking);

    res.status(201).json({
      travelerId,
      visaCopyUploaded: true,
      visaUploadedByAdminAt: docs.visa_uploaded_by_admin_at,
      documentsNotifiedAt: updated.documents_notified_at,
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/admin/bookings/:id/voucher — DOC-5.
export async function uploadVoucher(req, res, next) {
  try {
    const booking = await loadBookingOr404(req, res);
    if (!booking) return;

    if (!req.file) return res.status(400).json({ error: 'missing_file', message: 'Upload the booking voucher' });

    const upload = await uploadBuffer(req.file.buffer, { folderParts: ['bookings', booking.id, 'voucher'] });
    const voucher = await upsertBookingVoucher(booking.id, { voucherUrl: upload.secure_url, uploadedByUserId: req.user.id });

    await insertAuditLog({
      actorUserId: req.user.id,
      entity: 'booking',
      entityId: booking.id,
      field: 'voucher_uploaded',
      newValue: {},
    });

    const updated = await notifyAgentDocumentsReadyOnce(booking, req.user.id);
    emitBookingDocumentsChanged(booking);

    res.status(201).json({ uploaded: true, uploadedAt: voucher.uploaded_at, documentsNotifiedAt: updated.documents_notified_at });
  } catch (err) {
    next(err);
  }
}
