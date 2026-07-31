import { v2 as cloudinary } from 'cloudinary';
import { env } from '../config/env.js';

let configured = false;

function ensureConfigured() {
  if (configured) return true;
  if (!env.cloudinary.cloudName || !env.cloudinary.apiKey || !env.cloudinary.apiSecret) {
    return false;
  }
  cloudinary.config({
    cloud_name: env.cloudinary.cloudName,
    api_key: env.cloudinary.apiKey,
    api_secret: env.cloudinary.apiSecret,
    secure: true,
  });
  configured = true;
  return true;
}

/**
 * Server-mediated upload (doc §14.3): the API secret never leaves the server.
 * folderParts builds the doc's convention xclusive-oman/{env}/{entity}/{entity_id}/{doc_type}.
 */
export async function uploadBuffer(buffer, { folderParts, publicId, resourceType = 'auto' } = {}) {
  if (!ensureConfigured()) {
    throw Object.assign(new Error('Cloudinary is not configured (set CLOUDINARY_* in .env)'), {
      status: 503,
      publicCode: 'uploads_unavailable',
    });
  }

  const folder = ['xclusive-oman', env.nodeEnv, ...(folderParts || [])].join('/');

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, public_id: publicId, resource_type: resourceType },
      (error, result) => (error ? reject(error) : resolve(result))
    );
    stream.end(buffer);
  });
}
