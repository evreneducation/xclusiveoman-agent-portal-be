-- Employees & Roles (Employees.jsx) now lets an admin type an arbitrary
-- custom role ("Other", alongside picking Relationship Manager or Lead
-- Manager) when adding staff — the fixed user_role enum can't hold that, so
-- this widens the column to plain TEXT. Every existing comparison
-- (`role = 'finance'`, requireRole('ops_admin', ...), users.model.js, etc.)
-- keeps working unchanged — Postgres compares TEXT and enum-label values
-- identically — so nothing else needed to change alongside this. The
-- user_role type itself is left in place (unused by this column now, but
-- harmless, and cheaper/safer than confirming nothing else references it).
ALTER TABLE users ALTER COLUMN role TYPE TEXT USING role::text;
