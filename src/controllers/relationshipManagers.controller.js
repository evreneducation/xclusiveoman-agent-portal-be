import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import { listAgenciesByRmIds } from '../models/agencies.model.js';
import {
  createUser,
  findUserByEmail,
  findUserById,
  listStaffByRole,
  toPublicUser,
  updateUser,
} from '../models/users.model.js';
import { sendEmail } from '../services/email.service.js';
import { buildStaffWelcomeEmailHtml } from '../services/emailTemplate.service.js';

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

    // Best-effort — a flaky SMTP server must never fail account creation,
    // which has already succeeded by this point (same posture as
    // auth.controller.js#notifyAdminsOfNewAgent).
    try {
      const { html, attachments } = buildStaffWelcomeEmailHtml({
        fullName: user.full_name,
        roleLabel: 'Relationship Manager',
        email: user.email,
        loginUrl: env.adminLoginUrl,
      });
      await sendEmail({
        to: user.email,
        subject: 'Welcome to the Xclusive Oman team',
        text: `You've been added as a Relationship Manager on the Xclusive Oman B2B & MICE Trade Portal. Sign in at ${env.adminLoginUrl} with your work email (${user.email}) — we'll email you a one-time code.`,
        html,
        attachments,
      });
    } catch (err) {
      console.error('Failed to send RM welcome email', user.id, err);
    }

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
