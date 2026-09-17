const {
  pool
} = require('../db/pool.js');

const {
  createUser,
  findUserByEmail,
  toPublicUser
} = require('../models/users.model.js');

async function create(req, res, next) {
  const client = await pool.connect();
  try {
    const { fullName, email, phone, whatsappNumber, role } = req.body;

    const existing = await findUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'conflict', message: 'Email already registered' });
    }

    const user = await createUser(client, {
      agencyId: null,
      role,
      fullName,
      email,
      phone,
      whatsappNumber,
    });

    res.status(201).json({ user: toPublicUser(user) });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
}

module.exports.create = create;
