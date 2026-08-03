-- Adds a dedicated role for the Relationship Manager persona (doc §4 role
-- table, REL-1/REL-2). Previously any staff user could be pointed to by
-- agencies.rm_user_id with no way to list/manage the RM pool itself.
ALTER TYPE user_role ADD VALUE 'relationship_manager';
