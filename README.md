# Xclusive Oman — Portal Backend

Shared REST + WebSocket API for the Xclusive Oman B2B & MICE portal, per the master documentation
(§5 Tech Stack, §11 DB Schema, §12 REST API). This single backend serves **both** frontends, which
live as sibling folders inside `xclusiveoman-agent-portal-fe`:

- `xclusiveoman-agent-portal-fe/agent` — the agent-facing app (dev on `http://localhost:5173`)
- `xclusiveoman-agent-portal-fe/admin` — the staff/admin console (dev on `http://localhost:5174`)

**Scope so far**: Sprints 1–3 (doc §18) — auth/RBAC/approvals, product catalog + Fixed Group
Departures (booking, waitlist, Enquire Now), and payments (Cashfree + NEFT, transaction ledger).
Documents/operations, Custom FIT, MICE, and the engagement/analytics layers are later sprints.

## Stack

Node.js + Express (plain JS, ESM), PostgreSQL (`pg`), JWT auth (`jsonwebtoken`), Socket.IO,
Nodemailer (Google SMTP), Zod validation, bcryptjs.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in `DATABASE_URL` (your own Postgres instance) plus
   `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` (any long random strings for dev).
3. Run migrations: `npm run migrate`
4. Create a super admin account — pick one:
   - `npm run seed` — inserts a **dev-only default** super admin (idempotent, safe to re-run):
     `admin@xclusiveoman.com` / `Admin@12345`. **Change this password before any real deployment.**
   - `npm run create-super-admin -- you@example.com "StrongPass123" "Your Name"` — same effect,
     your own credentials, fails if that email is already taken.
5. Start the API: `npm run dev` (nodemon) or `npm start`. Listens on `PORT` (default `4000`).

Either way this is a direct DB insert, not a real API call — it's the only way to unlock
`/api/admin/*` routes before any super admin exists.

## Approving a new agency

Via the **admin portal UI** (`xclusiveoman-agent-portal-fe/admin`): log in as the seeded/created super
admin at `http://localhost:5174/admin/login`, open **Agent Approvals**, pick a pending agency, set
tier/credit limit/Relationship Manager, and Approve.

Or via the API directly (no UI needed):
1. Register an agency through the agent portal (or `POST /api/auth/register`) — it lands with
   `status = pending`.
2. Log in as the super admin: `POST /api/auth/login`, grab `accessToken`.
3. Optionally create a Relationship Manager: `POST /api/admin/team` with
   `{ "fullName", "email", "password", "role": "ops_admin" }` (or any staff role) — copy the
   returned `user.id`.
4. Approve the agency: `PATCH /api/admin/agencies/:id` with
   `{ "status": "approved", "tier": "gold", "creditLimit": 5000, "rmUserId": "<staff user id>" }`,
   `Authorization: Bearer <super admin accessToken>`.
5. The agency owner can now log in from the agent portal and will see their tier + RM on the
   dashboard.

## Known limitations (Sprint 1 only)

- Refresh tokens are stateless JWTs — there's no DB-backed revocation list yet, so logout only
  clears the cookie client-side. Fine for Foundations; worth hardening later.
- Password-reset emails fall back to `console.log` if `SMTP_*` is unset in `.env`, so the flow is
  testable without real Google SMTP credentials.
- The seeded super admin password (`Admin@12345`) is a well-known dev default — never use it, or
  reuse this seed script's approach, in a real deployment.
- Only Agent Approvals has a real admin UI so far (screens 09 + 10). The other ~24 admin screens
  (catalog, quotes/pricing, marketing, analytics, operations, etc.) are unbuilt; their routes/data
  model don't exist yet either — later sprints.

## Project layout

```
migrations/        SQL migrations, applied in filename order by src/db/migrate.js
scripts/            one-off CLI scripts: create-super-admin.js (bootstrap), seed.js (dev default)
src/
  config/           env loading/validation
  db/               pg pool + migration runner
  middleware/       auth (JWT verify + RBAC), error handling
  validation/       zod request schemas
  services/         password hashing/JWT signing, email sending
  models/           thin data-access functions (agencies, users)
  controllers/       request handlers
  routes/            express routers, mounted under /api
  sockets/           Socket.IO setup (JWT handshake auth, room joins)
  app.js, server.js
```
