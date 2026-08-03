-- Add-on pricing can vary by departure location (e.g. a tour priced
-- differently ex-Muscat vs ex-Salalah), so the same activity/tour can be
-- attached to a package multiple times, once per location/price combo.
ALTER TABLE fd_addons ADD COLUMN location TEXT;
