-- Adds a dedicated Sales Manager persona, distinct from the existing
-- sales_marketing role. Managed via the generic /admin/team CRUD (no
-- per-agency assignment concept, unlike relationship_manager).
ALTER TYPE user_role ADD VALUE 'sales_manager';
