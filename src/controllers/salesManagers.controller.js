import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
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

// GET /api/admin/sales-managers
// Lists the sales_manager staff pool. Unlike relationship managers, sales
// managers have no per-agency assignment concept (no agencies.*_user_id FK).
export async function list(req, res, next) {
  try {
    const salesManagers = await listStaffByRole('sales_manager');
    res.json({ salesManagers: salesManagers.map(toPublicUser) });
  } catch (err) {
    next(err);
  }
}

// POST /api/admin/sales-managers
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
      role: 'sales_manager',
      fullName,
      email,
      phone,
      whatsappNumber,
    });

    // Best-effort — a flaky SMTP server must never fail account creation,
    // which has already succeeded by this point (same posture as
    // auth.controller.js#notifyAdminsOfNewAgent). "Lead Manager" is the
    // admin UI's display label for this role (Employees.jsx) — the role
    // slug itself stays `sales_manager` in the DB/API.
    try {
      const { html, attachments } = buildStaffWelcomeEmailHtml({
        fullName: user.full_name,
        roleLabel: 'Lead Manager',
        email: user.email,
        loginUrl: env.adminLoginUrl,
      });
      await sendEmail({
        to: user.email,
        subject: 'Welcome to the Xclusive Oman team',
        text: `You've been added as a Lead Manager on the Xclusive Oman B2B & MICE Trade Portal. Sign in at ${env.adminLoginUrl} with your work email (${user.email}) — we'll email you a one-time code.`,
        html,
        attachments,
      });
    } catch (err) {
      console.error('Failed to send Lead Manager welcome email', user.id, err);
    }

    res.status(201).json({ user: toPublicUser(user) });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
}

// PATCH /api/admin/sales-managers/:id
export async function update(req, res, next) {
  try {
    const { id } = req.params;
    const target = await findUserById(id);
    if (!target || target.agency_id !== null || target.role !== 'sales_manager') {
      return res.status(404).json({ error: 'not_found' });
    }

    const user = await updateUser(id, req.body);
    res.json({ user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
}
