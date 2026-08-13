export function notFoundHandler(req, res) {
  res.status(404).json({ error: 'not_found', message: `No route for ${req.method} ${req.path}` });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  console.error(err);

  if (err.code === '23505') {
    // Postgres unique_violation
    return res.status(409).json({ error: 'conflict', message: 'Record already exists' });
  }

  if (err.code === '23503') {
    // Postgres foreign_key_violation — e.g. deleting an FD package that
    // still has bookings against one of its departure dates.
    return res.status(409).json({ error: 'conflict', message: 'This record is still referenced elsewhere and cannot be deleted.' });
  }

  const status = err.status || 500;
  res.status(status).json({
    error: err.publicCode || 'internal_error',
    message: status === 500 ? 'Something went wrong' : err.message,
  });
}
