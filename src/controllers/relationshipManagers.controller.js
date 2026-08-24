import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import { normalizeRmPermissions } from '../config/accessFeatures.js';
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

// GET /api/admin/relationship-managers?search=&page=&pageSize=
// Lists the relationship_manager staff pool, each annotated with the
// agencies currently pointing at them via agencies.rm_user_id (REL-1/REL-2).
// `search` (Employees table view) is a free-text match over name/email/
// phone/WhatsApp number, applied in JS same as admin.controller.js#getAgencies
// does for its own search — there's no index worth a SQL WHERE for a staff
// pool this small. `page`/`pageSize` pagination is opt-in (only applied when
// either is present in the query) and, same as getAgencies, no-store
// Cache-Control since an edit here (status/permissions) can change the very
// next request's result.
export async function list(req, res, next) {
  try {
    res.set('Cache-Control', 'no-store');
    const rms = await listStaffByRole('relationship_manager');
    const agencies = await listAgenciesByRmIds(rms.map((rm) => rm.id));

    let relationshipManagers = rms.map((rm) => ({
      ...toPublicUser(rm),
      assignedAgencies: agencies
        .filter((a) => a.rm_user_id === rm.id)
        .map((a) => ({ id: a.id, name: a.name })),
    }));

    const { search } = req.query;
    if (search) {
      const needle = search.trim().toLowerCase();
      relationshipManagers = relationshipManagers.filter((rm) =>
        [rm.fullName, rm.email, rm.phone, rm.whatsappNumber].some((v) => v && v.toLowerCase().includes(needle))
      );
    }

    const paginate = req.query.page !== undefined || req.query.pageSize !== undefined;
    if (!paginate) {
      return res.json({ relationshipManagers });
    }
    const total = relationshipManagers.length;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.max(1, Math.min(100, parseInt(req.query.pageSize, 10) || 10));
    const start = (page - 1) * pageSize;
    relationshipManagers = relationshipManagers.slice(start, start + pageSize);

    res.json({
      relationshipManagers,
      pagination: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    });
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
      // Access Features (config/accessFeatures.js) — see
      // salesManagers.controller.js#create's identical comment; same
      // normalize-on-write posture, just RM's own fixed key set.
      permissions: normalizeRmPermissions(req.body.permissions),
    });

    // Best-effort — a flaky Brevo send must never fail account creation,
    // which has already succeeded by this point (same posture as
    // auth.controller.js#notifyAdminsOfNewAgent). Links to the dedicated
    // /team portal (env.teamLoginUrl), not the Admin Console.
    try {
      const { html, attachments } = buildStaffWelcomeEmailHtml({
        fullName: user.full_name,
        roleLabel: 'Relationship Manager',
        email: user.email,
        loginUrl: env.teamLoginUrl,
        ctaLabel: 'Sign in to the Team Portal',
      });
      await sendEmail({
        to: user.email,
        subject: 'Welcome to the Xclusive Oman team',
        text: `You've been added as a Relationship Manager on the Xclusive Oman B2B & MICE Trade Portal. Sign in at ${env.teamLoginUrl} with your work email (${user.email}) — we'll email you a one-time code.`,
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

    // Access Features stay the fixed RM_FEATURE_KEYS shape even on a partial
    // PATCH — see salesManagers.controller.js#update's identical comment.
    const fields = { ...req.body };
    if (fields.permissions !== undefined) {
      fields.permissions = normalizeRmPermissions({ ...target.permissions, ...fields.permissions });
    }

    const user = await updateUser(id, fields);
    res.json({ user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
}
