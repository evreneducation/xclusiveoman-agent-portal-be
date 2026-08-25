import { pool } from '../db/pool.js';
import { createUser, findUserByEmail, toPublicUser } from '../models/users.model.js';

// POST /api/admin/employees/custom-role — Employees & Roles' unified "Add"
// button (Employees.jsx), the "Other" branch: an admin types a role that
// isn't Relationship Manager or Lead Manager. Unlike
// relationshipManagers/salesManagers.controller.js#create, this accepts any
// role string createCustomRoleEmployeeSchema lets through — that schema's
// RESERVED_ROLES already rejects every built-in role name (including
// relationship_manager/sales_manager, which have their own dedicated
// endpoints above), so this can't be used to mint an account with existing
// privileges.
//
// Deliberately minimal, per product decision: no Access Features, no
// welcome email, no /team login routing — this just records the person and
// their title in `users`. Nothing yet gives such an account anywhere to
// meaningfully sign in and land (LoginModal.jsx's isStaffUser/isTeamUser
// routing doesn't recognize a custom role — an agencyId-less user always
// counts as "staff" there, so they'd land on /admin/dashboard with no
// permissions rather than anywhere built for them), so no welcome email is
// sent inviting them to. Revisit once there's an actual portal for these
// roles.
export async function create(req, res, next) {
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
