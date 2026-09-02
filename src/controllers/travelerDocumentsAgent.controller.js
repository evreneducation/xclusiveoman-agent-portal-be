import { findBookingById } from '../models/bookings.model.js';
import {
  listTravelersWithDocuments,
  findTravelerInBooking,
  findTravelerDocumentsByTravelerId,
  saveAgentDocuments,
  findVoucherByBookingId,
} from '../models/documents.model.js';
import { insertAuditLog } from '../models/auditLogs.model.js';
import { uploadBuffer } from '../services/cloudinary.service.js';
import { fetchDocumentBuffer, extFromUrl } from '../services/documentZip.service.js';

// Agent-side Traveler Document Upload (Task 14 — DOC-1, DOC-6). Mounted
// into the existing bookings.routes.js router (requireAuth,
// requireRole('agency_owner','agency_staff')) — same agency-ownership
// posture as payments.controller.js#assertOwnsBooking: every handler here
// re-checks booking.agency_id === req.user.agency_id itself, never trusting
// the :id in the URL.

// "Once a booking is confirmed" (doc §9.6 step 30) — the concrete statuses
// this codebase's own confirmPayment()/booking.service.js ever actually
// produce beyond pending_payment/waitlisted. Matches Task 13's own
// deposit-driven status derivation (pending_payment -> confirmed/fully_paid).
const UPLOAD_ELIGIBLE_STATUSES = new Set(['confirmed', 'balance_due', 'fully_paid', 'completed']);

const DOC_TYPE_COLUMN = {
  passport_scan: 'passport_scan_url',
  passport_photo: 'passport_photo_url',
  visa_copy: 'visa_copy_url',
};

// Admin-uploaded documents (visa copy, voucher) used to stay locked behind a
// separate manual "Notify Agent" click (documents_notified_at, DOC-6) even
// after being uploaded — every document here is now downloadable the
// instant it exists; "documentsNotifiedAt" on the booking below is purely
// informational (when the one-time ready notification/email fired, see
// travelerDocumentsAdmin.controller.js#notifyAgentDocumentsReadyOnce), not a
// gate on anything.
function toPublicTravelerDocs(row) {
  return {
    travelerId: row.id,
    name: row.name,
    passportScanUploaded: !!row.passport_scan_url,
    passportPhotoUploaded: !!row.passport_photo_url,
    visaCopyUploaded: !!row.visa_copy_url,
    visaCopyDownloadable: !!row.visa_copy_url,
  };
}

async function loadOwnedBookingOr404(req, res) {
  const booking = await findBookingById(req.params.id);
  if (!booking || booking.agency_id !== req.user.agency_id) {
    res.status(404).json({ error: 'not_found' });
    return null;
  }
  return booking;
}

// GET /api/bookings/:id/documents
export async function getDocuments(req, res, next) {
  try {
    const booking = await loadOwnedBookingOr404(req, res);
    if (!booking) return;

    const [travelers, voucher] = await Promise.all([
      listTravelersWithDocuments(booking.id),
      findVoucherByBookingId(booking.id),
    ]);

    res.json({
      booking: {
        id: booking.id,
        status: booking.status,
        uploadEligible: UPLOAD_ELIGIBLE_STATUSES.has(booking.status),
        documentsNotifiedAt: booking.documents_notified_at,
      },
      travelers: travelers.map(toPublicTravelerDocs),
      voucher: {
        uploaded: !!voucher,
        downloadable: !!voucher,
      },
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/bookings/:id/travelers/:travelerId/documents — DOC-1. multipart
// fields: passportScan, passportPhoto (either or both; at least one required).
export async function uploadDocuments(req, res, next) {
  try {
    const booking = await loadOwnedBookingOr404(req, res);
    if (!booking) return;

    if (!UPLOAD_ELIGIBLE_STATUSES.has(booking.status)) {
      return res.status(400).json({
        error: 'booking_not_confirmed',
        message: 'Traveler documents can only be uploaded once this booking is confirmed.',
      });
    }

    const traveler = await findTravelerInBooking(req.params.travelerId, booking.id);
    if (!traveler) return res.status(404).json({ error: 'traveler_not_found' });

    const scanFile = req.files?.passportScan?.[0];
    const photoFile = req.files?.passportPhoto?.[0];
    if (!scanFile && !photoFile) {
      return res.status(400).json({ error: 'missing_file', message: 'Upload a passport scan and/or a passport-size photo.' });
    }

    const [scanUpload, photoUpload] = await Promise.all([
      scanFile ? uploadBuffer(scanFile.buffer, { folderParts: ['bookings', booking.id, 'travelers', traveler.id, 'passport-scan'] }) : null,
      photoFile ? uploadBuffer(photoFile.buffer, { folderParts: ['bookings', booking.id, 'travelers', traveler.id, 'passport-photo'] }) : null,
    ]);

    const docs = await saveAgentDocuments(traveler.id, {
      passportScanUrl: scanUpload?.secure_url,
      passportPhotoUrl: photoUpload?.secure_url,
    });

    await insertAuditLog({
      actorUserId: req.user.id,
      entity: 'booking',
      entityId: booking.id,
      field: 'traveler_documents_uploaded',
      newValue: {
        travelerId: traveler.id,
        travelerName: traveler.name,
        passportScan: !!scanUpload,
        passportPhoto: !!photoUpload,
      },
    });

    res.status(201).json({
      travelerId: traveler.id,
      passportScanUploaded: !!docs.passport_scan_url,
      passportPhotoUploaded: !!docs.passport_photo_url,
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/bookings/:id/travelers/:travelerId/documents/:type/download —
// every document type here is downloadable as soon as it exists (agent's own
// passport uploads always were; visa_copy no longer waits on a separate
// admin release — see this file's own top comment).
export async function downloadTravelerDocument(req, res, next) {
  try {
    const { travelerId, type } = req.params;
    const column = DOC_TYPE_COLUMN[type];
    if (!column) return res.status(400).json({ error: 'invalid_document_type' });

    const booking = await loadOwnedBookingOr404(req, res);
    if (!booking) return;

    const traveler = await findTravelerInBooking(travelerId, booking.id);
    if (!traveler) return res.status(404).json({ error: 'traveler_not_found' });

    const docs = await findTravelerDocumentsByTravelerId(travelerId);
    const url = docs?.[column];
    if (!url) return res.status(404).json({ error: 'document_not_found' });

    const buffer = await fetchDocumentBuffer(url);
    res.setHeader('Content-Type', 'application/octet-stream');
    // Traveler name included (not just the doc type) — matches
    // travelerDocumentsAdmin.controller.js's own downloadTravelerDocument
    // naming, and the frontend now trusts this header entirely
    // (shared/documents/downloadDocument.js) rather than reconstructing a
    // filename itself, so the two must actually agree.
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${type}_${traveler.name.replace(/[^a-z0-9]/gi, '_')}.${extFromUrl(url)}"`
    );
    res.send(buffer);
  } catch (err) {
    next(err);
  }
}

// GET /api/bookings/:id/voucher/download — downloadable as soon as it's
// uploaded, no separate admin release step.
export async function downloadVoucher(req, res, next) {
  try {
    const booking = await loadOwnedBookingOr404(req, res);
    if (!booking) return;

    const voucher = await findVoucherByBookingId(booking.id);
    if (!voucher) return res.status(404).json({ error: 'voucher_not_found' });

    const buffer = await fetchDocumentBuffer(voucher.voucher_url);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="voucher.${extFromUrl(voucher.voucher_url)}"`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
}
