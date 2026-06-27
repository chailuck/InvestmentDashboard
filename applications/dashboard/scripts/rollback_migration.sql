-- =============================================================================
-- rollback_migration.sql
-- Manually undo the Admin → Pop migration.
--
-- WHEN TO USE
--   The migration script runs in a single transaction; if it fails, Postgres
--   rolls back automatically — this script is NOT needed in that case.
--   Use this script ONLY if:
--     (a) the migration committed successfully, AND
--     (b) you later discover a problem and want to revert Pop to a clean state.
--
-- WHAT IT DOES
--   - Deletes ALL data rows owned by Pop (cascade-safe order)
--   - Resets Pop's portfolio_mode back to 'excel'
--   - Does NOT touch Admin data
--
-- HOW TO RUN
--   docker exec inv_postgres psql -U postgres -d investment_db \
--          -f /tmp/rollback_migration.sql
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

DO $$ BEGIN
    RAISE NOTICE '=== Rollback: removing Pop migration data at % ===', now();
END $$;

-- Delete in reverse FK dependency order.
-- CASCADE-defined FKs (ondelete="CASCADE") handle child rows automatically,
-- but we delete in explicit order for clarity and safety.

-- weekly_review_items (child of weekly_reviews)
DELETE FROM weekly_review_items
WHERE review_id IN (
    SELECT id FROM weekly_reviews
    WHERE user_id = 'bef6cbae-545c-4a26-8026-b02749bcdf56'
);

DELETE FROM weekly_reviews
WHERE user_id = 'bef6cbae-545c-4a26-8026-b02749bcdf56';

-- pe_scan_results
DELETE FROM pe_scan_results
WHERE user_id = 'bef6cbae-545c-4a26-8026-b02749bcdf56';

-- weekly_scan_items (child of weekly_scans)
DELETE FROM weekly_scan_items
WHERE scan_id IN (
    SELECT id FROM weekly_scans
    WHERE user_id = 'bef6cbae-545c-4a26-8026-b02749bcdf56'
);

DELETE FROM weekly_scans
WHERE user_id = 'bef6cbae-545c-4a26-8026-b02749bcdf56';

-- user_symbol_lists
DELETE FROM user_symbol_lists
WHERE user_id = 'bef6cbae-545c-4a26-8026-b02749bcdf56';

-- user_scan_configs
DELETE FROM user_scan_configs
WHERE user_id = 'bef6cbae-545c-4a26-8026-b02749bcdf56';

-- purchase_plan_items + portfolio_plan_items (child of action_plans)
DELETE FROM purchase_plan_items
WHERE plan_id IN (
    SELECT id FROM action_plans
    WHERE created_by = 'bef6cbae-545c-4a26-8026-b02749bcdf56'
);

DELETE FROM portfolio_plan_items
WHERE plan_id IN (
    SELECT id FROM action_plans
    WHERE created_by = 'bef6cbae-545c-4a26-8026-b02749bcdf56'
);

DELETE FROM action_plans
WHERE created_by = 'bef6cbae-545c-4a26-8026-b02749bcdf56';

-- symbol_notes
DELETE FROM symbol_notes
WHERE user_id = 'bef6cbae-545c-4a26-8026-b02749bcdf56';

-- portfolio_positions_db
-- Must clear parent_id self-references first to avoid FK constraint errors
UPDATE portfolio_positions_db
SET parent_id = NULL
WHERE user_id = 'bef6cbae-545c-4a26-8026-b02749bcdf56'
  AND parent_id IS NOT NULL;

DELETE FROM portfolio_positions_db
WHERE user_id = 'bef6cbae-545c-4a26-8026-b02749bcdf56';

-- investment_transactions
DELETE FROM investment_transactions
WHERE user_id = 'bef6cbae-545c-4a26-8026-b02749bcdf56';

-- holdings (child of portfolios)
DELETE FROM holdings
WHERE portfolio_id IN (
    SELECT id FROM portfolios
    WHERE user_id = 'bef6cbae-545c-4a26-8026-b02749bcdf56'
);

-- portfolios
DELETE FROM portfolios
WHERE user_id = 'bef6cbae-545c-4a26-8026-b02749bcdf56';

-- Reset Pop's user record back to excel mode
UPDATE users
SET
    portfolio_mode     = 'excel',
    updated_at         = now()
WHERE id = 'bef6cbae-545c-4a26-8026-b02749bcdf56';

DO $$ BEGIN
    RAISE NOTICE '=== Rollback complete at % ===', now();
    RAISE NOTICE 'Pop user is now clean (zero data, portfolio_mode=excel).';
END $$;

COMMIT;
