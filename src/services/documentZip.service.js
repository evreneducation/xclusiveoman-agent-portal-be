const archiver = require('archiver');

async function streamDocumentsZip(res, entries) {
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

module.exports.streamDocumentsZip = streamDocumentsZip;

async function fetchDocumentBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw Object.assign(new Error('Unable to fetch the document from storage'), { status: 502 });
  }
  return Buffer.from(await response.arrayBuffer());
}

module.exports.fetchDocumentBuffer = fetchDocumentBuffer;

function extFromUrl(url) {
  const clean = url.split('?')[0];
  const match = clean.match(/\.([a-zA-Z0-9]+)$/);
  return match ? match[1] : 'bin';
}

module.exports.extFromUrl = extFromUrl;
