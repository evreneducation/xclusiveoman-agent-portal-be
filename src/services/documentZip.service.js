import archiver from 'archiver';

// DOC-2 — "download all documents as a ZIP". Streams directly to the given
// writable (the HTTP response) rather than buffering the whole archive in
// memory first — this could grow with traveler count. `entries` is
// [{ path, url }] — `path` is already resolved by the caller into the
// documented Booking_<id>/Traveler_<n>/... folder structure (see
// bookingDocuments.controller.js's own buildZipEntries), so this function's
// only job is "fetch each URL, put it at that path in the zip".
export async function streamDocumentsZip(res, entries) {
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => {
    throw err;
  });
  archive.pipe(res);

  for (const entry of entries) {
    try {
      const response = await fetch(entry.url);
      if (!response.ok) continue; // one unreachable document shouldn't sink the whole export
      const buffer = Buffer.from(await response.arrayBuffer());
      archive.append(buffer, { name: entry.path });
    } catch {
      // Same posture as above — skip, don't abort.
    }
  }

  await archive.finalize();
}

// Shared by individual-download and email-attachment paths — fetches a
// Cloudinary-hosted document into a buffer server-side (never redirects the
// caller to the raw storage URL — Phase 3's "don't expose raw storage URLs"
// requirement).
export async function fetchDocumentBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw Object.assign(new Error('Unable to fetch the document from storage'), { status: 502 });
  }
  return Buffer.from(await response.arrayBuffer());
}

// Cloudinary secure_urls keep the original file extension — this just reads
// it back off the URL for both zip-entry and download-attachment filenames.
export function extFromUrl(url) {
  const clean = url.split('?')[0];
  const match = clean.match(/\.([a-zA-Z0-9]+)$/);
  return match ? match[1] : 'bin';
}
