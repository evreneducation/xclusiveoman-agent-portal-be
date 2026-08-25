import { pool } from '../db/pool.js';
import { listStaff, listStaffByRole, findUserById, updateUser, toPublicUser } from '../models/users.model.js';
import { listAgenciesByRmIds } from '../models/agencies.model.js';

const KNOWN_ROLE_LABELS = {
  relationship_manager: 'Relationship Manager',
  sales_manager: 'Lead Manager',
};

// Core Admin Console roles (mirrors admin/context/AuthContext.jsx's own
// ADMIN_ROLES allow-list on the frontend) never belong on the Employees &
// Roles page — that page manages Relationship Managers, Lead Managers, and
// custom non-portal roles only. Every function below excludes these: the
// role dropdown can never surface a super_admin/ops_admin/finance/support/
// sales_marketing account, the generic listing can never be filtered to
// show them, and the generic PATCH can never edit (or disable!) one —
// admin-staff accounts stay untouchable through this generic surface.
const EXCLUDED_ROLES = new Set(['super_admin', 'ops_admin', 'finance', 'support', 'sales_marketing']);

// 'marketing_manager' -> 'Marketing Manager' — every custom role
// (customRoleEmployees.controller.js) only ever had its snake_case DB value
// saved, never a separate display label, so this is derived on read rather
// than stored.
function humanizeRole(role) {
  return KNOWN_ROLE_LABELS[role] || role.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function roleRank(role) {
  return role === 'relationship_manager' ? 0 : role === 'sales_manager' ? 1 : 2;
}

// GET /api/admin/employees/roles — powers the Employees page's role
// dropdown (replaces the old fixed Relationship Manager/Lead Manager tab
// pair). Relationship Manager and Lead Manager always appear (even with
// zero staff yet) since they're this app's two functional, fully-featured
// roles — Create/Edit for those still goes through their own dedicated
// endpoints (relationshipManagers/salesManagers.controller.js). Every other
// role is whatever's actually been typed into the "Other" field on the Add
// Employee modal and saved (customRoleEmployees.controller.js) — it only
// shows up here once at least one person holds it, and disappears again if
// that becomes zero (e.g. everyone with it is later edited to a different
// role) — nothing keeps a placeholder around for a custom role no one has.
export async function listRoles(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT role, COUNT(*)::int AS count FROM users WHERE agency_id IS NULL GROUP BY role`
    );
    const counts = new Map(rows.filter((r) => !EXCLUDED_ROLES.has(r.role)).map((r) => [r.role, r.count]));
    for (const known of Object.keys(KNOWN_ROLE_LABELS)) {
      if (!counts.has(known)) counts.set(known, 0);
    }

    const roles = [...counts.entries()]
      .map(([role, count]) => ({ role, label: humanizeRole(role), count }))
      .sort((a, b) => roleRank(a.role) - roleRank(b.role) || a.label.localeCompare(b.label));

    res.json({ roles });
  } catch (err) {
    next(err);
  }
}

// GET /api/admin/employees?role=&search=&page=&pageSize= — generic staff
// listing for any role, unlike relationshipManagers/salesManagers
// .controller.js's own list() (each hardcoded to one role, with their own
// Access-Features-aware create/update flows, untouched). Powers the
// Employees page's table once a role is picked from the dropdown above.
// `role` omitted lists every staff user regardless of role.
export async function list(req, res, next) {
  try {
    res.set('Cache-Control', 'no-store');
    const { role, search } = req.query;
    if (role && EXCLUDED_ROLES.has(role)) {
      return res.status(400).json({ error: 'invalid_role', message: 'That role is not managed from this page' });
    }
    const rows = (role ? await listStaffByRole(role) : await listStaff()).filter((r) => !EXCLUDED_ROLES.has(r.role));

    // Assigned-agencies annotation only makes sense for Relationship
    // Managers (agencies.rm_user_id) — same data relationshipManagers
    // .controller.js#list already joins in for its own dedicated endpoint.
    const rmIds = rows.filter((r) => r.role === 'relationship_manager').map((r) => r.id);
    const agencies = rmIds.length ? await listAgenciesByRmIds(rmIds) : [];
    const assignedAgenciesByUserId = new Map();
    for (const a of agencies) {
      if (!a.rm_user_id) continue;
      const list = assignedAgenciesByUserId.get(a.rm_user_id) || [];
      list.push({ id: a.id, name: a.name });
      assignedAgenciesByUserId.set(a.rm_user_id, list);
    }

    let employees = rows.map((r) => ({
      ...toPublicUser(r),
      roleLabel: humanizeRole(r.role),
      ...(r.role === 'relationship_manager' ? { assignedAgencies: assignedAgenciesByUserId.get(r.id) || [] } : {}),
    }));

    if (search) {
      const needle = search.trim().toLowerCase();
      employees = employees.filter((e) =>
        [e.fullName, e.email, e.phone, e.whatsappNumber].some((v) => v && v.toLowerCase().includes(needle))
      );
    }

    const paginate = req.query.page !== undefined || req.query.pageSize !== undefined;
    if (!paginate) {
      return res.json({ employees });
    }
    const total = employees.length;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.max(1, Math.min(100, parseInt(req.query.pageSize, 10) || 10));
    const start = (page - 1) * pageSize;
    employees = employees.slice(start, start + pageSize);

    res.json({ employees, pagination: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) } });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/admin/employees/:id — basic-field edit (full name/phone/
// WhatsApp/status) for any staff user regardless of role. Access Features
// (permissions) only exist for Relationship Manager/Lead Manager and stay
// on their own dedicated PATCH endpoints
// (relationshipManagers/salesManagers.controller.js#update) —
// patchGenericEmployeeSchema (validation/schemas.js) never accepts a
// `permissions` field here, so this can't be used to grant Access Features
// to a custom-role account that has no defined feature set.
export async function update(req, res, next) {
  try {
    const { id } = req.params;
    const target = await findUserById(id);
    if (!target || target.agency_id !== null) {
      return res.status(404).json({ error: 'not_found' });
    }
    if (EXCLUDED_ROLES.has(target.role)) {
      return res.status(403).json({ error: 'forbidden', message: 'That role is not managed from this page' });
    }
    const user = await updateUser(id, req.body);
    res.json({ user: { ...toPublicUser(user), roleLabel: humanizeRole(user.role) } });
  } catch (err) {
    next(err);
  }
}
