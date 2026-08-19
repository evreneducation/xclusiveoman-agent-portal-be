import { pool } from '../db/pool.js';
import { listAgenciesByRmIds } from '../models/agencies.model.js';
import {
  createUser,
  findUserByEmail,
  findUserById,
  listStaffByRole,
  toPublicUser,
  updateUser,
} from '../models/users.model.js';

// GET /api/admin/relationship-managers
// Lists the relationship_manager staff pool, each annotated with the
// agencies currently pointing at them via agencies.rm_user_id (REL-1/REL-2).
export async function list(req, res, next) {
  try {
    const rms = await listStaffByRole('relationship_manager');
    const agencies = await listAgenciesByRmIds(rms.map((rm) => rm.id));

    const relationshipManagers = rms.map((rm) => ({
      ...toPublicUser(rm),
      assignedAgencies: agencies
        .filter((a) => a.rm_user_id === rm.id)
        .map((a) => ({ id: a.id, name: a.name })),
    }));

    res.json({ relationshipManagers });
  } catch (err) {
    next(err);
  }
}

// POST /api/admin/relationship-managers
export async function create(req, res, next) {
  const client = await pool.connect();
  try {
    const { fullName, email, phone, whatsappNumber } = req.body;

    const existing = await findUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'conflict', message: 'Email already registered' });
    }

    const user = await createUser(client, {
      agencyId: null,
      role: 'relationship_manager',
      fullName,
      email,
      phone,
      whatsappNumber,
    });

    res.status(201).json({ user: { ...toPublicUser(user), assignedAgencies: [] } });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
}

// PATCH /api/admin/relationship-managers/:id
export async function update(req, res, next) {
  try {
    const { id } = req.params;
    const target = await findUserById(id);
    if (!target || target.agency_id !== null || target.role !== 'relationship_manager') {
      return res.status(404).json({ error: 'not_found' });
    }

    const user = await updateUser(id, req.body);
    res.json({ user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
}
