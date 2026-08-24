import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import { normalizeLmPermissions } from '../config/accessFeatures.js';
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

// GET /api/admin/sales-managers?search=&page=&pageSize=
// Lists the sales_manager staff pool. Unlike relationship managers, sales
// managers have no per-agency assignment concept (no agencies.*_user_id FK).
// Same search/pagination/no-store convention as
// relationshipManagers.controller.js#list — see its own comment.
export async function list(req, res, next) {
  try {
    res.set('Cache-Control', 'no-store');
    let salesManagers = (await listStaffByRole('sales_manager')).map(toPublicUser);

    const { search } = req.query;
    if (search) {
      const needle = search.trim().toLowerCase();
      salesManagers = salesManagers.filter((sm) =>
        [sm.fullName, sm.email, sm.phone, sm.whatsappNumber].some((v) => v && v.toLowerCase().includes(needle))
      );
    }

    const paginate = req.query.page !== undefined || req.query.pageSize !== undefined;
    if (!paginate) {
      return res.json({ salesManagers });
    }
    const total = salesManagers.length;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.max(1, Math.min(100, parseInt(req.query.pageSize, 10) || 10));
    const start = (page - 1) * pageSize;
    salesManagers = salesManagers.slice(start, start + pageSize);

    res.json({ salesManagers, pagination: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) } });
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
      // Access Features (config/accessFeatures.js) — decides both the /team
      // sidebar sections this LM sees and, via middleware/auth.js
      // #requireFeature, which admin.* API routes they can actually call.
      // Normalized here (not left as whatever the client sent) so
      // users.permissions always has the full LM_FEATURE_KEYS shape, never
      // a partial or stale one.
      permissions: normalizeLmPermissions(req.body.permissions),
    });

    // Best-effort — a flaky Brevo send must never fail account creation,
    // which has already succeeded by this point (same posture as
    // auth.controller.js#notifyAdminsOfNewAgent). "Lead Manager" is the
    // admin UI's display label for this role (Employees.jsx) — the role
    // slug itself stays `sales_manager` in the DB/API. Links to the
    // dedicated /team portal (env.teamLoginUrl), not the Admin Console —
    // an LM only ever sees the Access Features an admin checked for them.
    try {
      const { html, attachments } = buildStaffWelcomeEmailHtml({
        fullName: user.full_name,
        roleLabel: 'Lead Manager',
        email: user.email,
        loginUrl: env.teamLoginUrl,
        ctaLabel: 'Sign in to the Team Portal',
      });
      await sendEmail({
        to: user.email,
        subject: 'Welcome to the Xclusive Oman team',
        text: `You've been added as a Lead Manager on the Xclusive Oman B2B & MICE Trade Portal. Sign in at ${env.teamLoginUrl} with your work email (${user.email}) — we'll email you a one-time code.`,
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

    // Access Features stay the fixed LM_FEATURE_KEYS shape even on a partial
    // PATCH — merged onto the account's *current* permissions (not the bare
    // defaults) so editing just one checkbox from the Manage panel can never
    // silently reset the others back to their create-time defaults.
    const fields = { ...req.body };
    if (fields.permissions !== undefined) {
      fields.permissions = normalizeLmPermissions({ ...target.permissions, ...fields.permissions });
    }

    const user = await updateUser(id, fields);
    res.json({ user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
}
