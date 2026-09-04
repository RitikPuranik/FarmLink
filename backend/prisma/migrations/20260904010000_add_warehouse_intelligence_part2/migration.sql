-- Module 9 Part 2 — Warehouse Intelligence: Storage Availability & Capacity
-- Management.
--
-- No new tables/columns: Part 1 already persists everything Part 2 needs
-- to answer availability/capacity questions honestly (Warehouse.latitude/
-- longitude, WarehouseStorageUnit.totalCapacity/availableCapacity/
-- capacityUnit, WarehouseCropCapability.compatibility). This migration
-- only adds the index the new bounding-box nearby-search query needs to
-- stay a seek instead of a full-table scan.
CREATE INDEX IF NOT EXISTS "warehouses_latitude_longitude_idx" ON "warehouses" ("latitude", "longitude");
