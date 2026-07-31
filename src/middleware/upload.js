import multer from 'multer';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

// Doc §16: file upload endpoints validate MIME type and size before generating
// a Cloudinary signature (here, before the server-mediated upload call).
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(Object.assign(new Error('Unsupported file type'), { status: 400 }));
    }
    cb(null, true);
  },
});
