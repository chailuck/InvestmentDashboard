-- =============================================================================
-- verify_migration.sql
-- Run AFTER migrate_admin_to_pop.sql to confirm all row counts are correct.
--
-- HOW TO RUN
--   docker exec inv_postgres psql -U postgres -d investment_db \
--          -f /tmp/verify_migration.sql
-- =============================================================================

\set ADMIN_ID 'aa433282-379c-49a3-8eb7-fffe9bafa60d'
\set POP_ID   'bef6cbae-545c-4a26-8026-b02749bcdf56'

\echo ''
\echo '======================================================================='
\echo '  VERIFICATION: Admin data vs Pop data after migration'
\echo '======================================================================='

-- ---------------------------------------------------------------------------
-- 1. User records — confirm Pop is now in db mode
-- ---------------------------------------------------------------------------
\echo ''
\echo '--- users ---'
SELECT
    email,
    role,
    portfolio_mode,
    excel_source_path IS NULL AS excel_source_null,
    excel_working_path IS NULL AS excel_working_null
FROM users
WHERE id IN (
    'aa433282-379c-49a3-8eb7-fffe9bafa60d',
    'bef6cbae-545c-4a26-8026-b02749bcdf56'
)
ORDER BY email;

-- ---------------------------------------------------------------------------
-- 2. portfolios — expect 2 for Admin, 2 for Pop (both in db mode)
-- ---------------------------------------------------------------------------
\echo ''
\echo '--- portfolios ---'
SELECT
    u.email,
    COUNT(*)         AS portfolio_count,
    STRING_AGG(p.name || ' [' || p.portfolio_mode || ']', ', ' ORDER BY p.name) AS portfolios
FROM portfolios p
JOIN users u ON u.id = p.user_id
WHERE p.user_id IN (
    'aa433282-379c-49a3-8eb7-fffe9bafa60d',
    'bef6cbae-545c-4a26-8026-b02749bcdf56'
)
GROUP BY u.email
ORDER BY u.email;

-- ---------------------------------------------------------------------------
-- 3. Row count summary — one row per table per user
-- ---------------------------------------------------------------------------
\echo ''
\echo '--- row counts per table ---'
SELECT 'portfolios'            AS tbl, 'admin' AS usr, COUNT(*) AS cnt FROM portfolios              WHERE user_id = 'aa433282-379c-49a3-8eb7-fffe9bafa60d'
UNION ALL
SELECT 'portfolios',                   'pop',           COUNT(*) FROM portfolios                    WHERE user_id = 'bef6cbae-545c-4a26-8026-b02749bcdf56'
UNION ALL
SELECT 'holdings',                     'admin',         COUNT(*) FROM holdings h JOIN portfolios p ON p.id = h.portfolio_id WHERE p.user_id = 'aa433282-379c-49a3-8eb7-fffe9bafa60d'
UNION ALL
SELECT 'holdings',                     'pop',           COUNT(*) FROM holdings h JOIN portfolios p ON p.id = h.portfolio_id WHERE p.user_id = 'bef6cbae-545c-4a26-8026-b02749bcdf56'
UNION ALL
SELECT 'investment_transactions',      'admin',         COUNT(*) FROM investment_transactions       WHERE user_id = 'aa433282-379c-49a3-8eb7-fffe9bafa60d'
UNION ALL
SELECT 'investment_transactions',      'pop',           COUNT(*) FROM investment_transactions       WHERE user_id = 'bef6cbae-545c-4a26-8026-b02749bcdf56'
UNION ALL
SELECT 'portfolio_positions_db',       'admin',         COUNT(*) FROM portfolio_positions_db        WHERE user_id = 'aa433282-379c-49a3-8eb7-fffe9bafa60d'
UNION ALL
SELECT 'portfolio_positions_db',       'pop',           COUNT(*) FROM portfolio_positions_db        WHERE user_id = 'bef6cbae-545c-4a26-8026-b02749bcdf56'
UNION ALL
SELECT 'action_plans',                 'admin',         COUNT(*) FROM action_plans                  WHERE created_by = 'aa433282-379c-49a3-8eb7-fffe9bafa60d'
UNION ALL
SELECT 'action_plans',                 'pop',           COUNT(*) FROM action_plans                  WHERE created_by = 'bef6cbae-545c-4a26-8026-b02749bcdf56'
UNION ALL
SELECT 'purchase_plan_items',          'admin',         COUNT(*) FROM purchase_plan_items ppi JOIN action_plans ap ON ap.id = ppi.plan_id WHERE ap.created_by = 'aa433282-379c-49a3-8eb7-fffe9bafa60d'
UNION ALL
SELECT 'purchase_plan_items',          'pop',           COUNT(*) FROM purchase_plan_items ppi JOIN action_plans ap ON ap.id = ppi.plan_id WHERE ap.created_by = 'bef6cbae-545c-4a26-8026-b02749bcdf56'
UNION ALL
SELECT 'portfolio_plan_items',         'admin',         COUNT(*) FROM portfolio_plan_items ppi JOIN action_plans ap ON ap.id = ppi.plan_id WHERE ap.created_by = 'aa433282-379c-49a3-8eb7-fffe9bafa60d'
UNION ALL
SELECT 'portfolio_plan_items',         'pop',           COUNT(*) FROM portfolio_plan_items ppi JOIN action_plans ap ON ap.id = ppi.plan_id WHERE ap.created_by = 'bef6cbae-545c-4a26-8026-b02749bcdf56'
UNION ALL
SELECT 'user_scan_configs',            'admin',         COUNT(*) FROM user_scan_configs             WHERE user_id = 'aa433282-379c-49a3-8eb7-fffe9bafa60d'
UNION ALL
SELECT 'user_scan_configs',            'pop',           COUNT(*) FROM user_scan_configs             WHERE user_id = 'bef6cbae-545c-4a26-8026-b02749bcdf56'
UNION ALL
SELECT 'user_symbol_lists',            'admin',         COUNT(*) FROM user_symbol_lists             WHERE user_id = 'aa433282-379c-49a3-8eb7-fffe9bafa60d'
UNION ALL
SELECT 'user_symbol_lists',            'pop',           COUNT(*) FROM user_symbol_lists             WHERE user_id = 'bef6cbae-545c-4a26-8026-b02749bcdf56'
UNION ALL
SELECT 'weekly_scans',                 'admin',         COUNT(*) FROM weekly_scans                  WHERE user_id = 'aa433282-379c-49a3-8eb7-fffe9bafa60d'
UNION ALL
SELECT 'weekly_scans',                 'pop',           COUNT(*) FROM weekly_scans                  WHERE user_id = 'bef6cbae-545c-4a26-8026-b02749bcdf56'
UNION ALL
SELECT 'weekly_scan_items',            'admin',         COUNT(*) FROM weekly_scan_items wsi JOIN weekly_scans ws ON ws.id = wsi.scan_id WHERE ws.user_id = 'aa433282-379c-49a3-8eb7-fffe9bafa60d'
UNION ALL
SELECT 'weekly_scan_items',            'pop',           COUNT(*) FROM weekly_scan_items wsi JOIN weekly_scans ws ON ws.id = wsi.scan_id WHERE ws.user_id = 'bef6cbae-545c-4a26-8026-b02749bcdf56'
UNION ALL
SELECT 'pe_scan_results',              'admin',         COUNT(*) FROM pe_scan_results               WHERE user_id = 'aa433282-379c-49a3-8eb7-fffe9bafa60d'
UNION ALL
SELECT 'pe_scan_results',              'pop',           COUNT(*) FROM pe_scan_results               WHERE user_id = 'bef6cbae-545c-4a26-8026-b02749bcdf56'
UNION ALL
SELECT 'symbol_notes',                 'admin',         COUNT(*) FROM symbol_notes                  WHERE user_id = 'aa433282-379c-49a3-8eb7-fffe9bafa60d'
UNION ALL
SELECT 'symbol_notes',                 'pop',           COUNT(*) FROM symbol_notes                  WHERE user_id = 'bef6cbae-545c-4a26-8026-b02749bcdf56'
UNION ALL
SELECT 'weekly_reviews',               'admin',         COUNT(*) FROM weekly_reviews                WHERE user_id = 'aa433282-379c-49a3-8eb7-fffe9bafa60d'
UNION ALL
SELECT 'weekly_reviews',               'pop',           COUNT(*) FROM weekly_reviews                WHERE user_id = 'bef6cbae-545c-4a26-8026-b02749bcdf56'
UNION ALL
SELECT 'weekly_review_items',          'admin',         COUNT(*) FROM weekly_review_items wri JOIN weekly_reviews wr ON wr.id = wri.review_id WHERE wr.user_id = 'aa433282-379c-49a3-8eb7-fffe9bafa60d'
UNION ALL
SELECT 'weekly_review_items',          'pop',           COUNT(*) FROM weekly_review_items wri JOIN weekly_reviews wr ON wr.id = wri.review_id WHERE wr.user_id = 'bef6cbae-545c-4a26-8026-b02749bcdf56'
ORDER BY tbl, usr;

-- ---------------------------------------------------------------------------
-- 4. source_position_id integrity check
--    All non-null source_position_ids in Pop's review items must resolve
--    to a position owned by Pop. Count of orphans should be 0.
-- ---------------------------------------------------------------------------
\echo ''
\echo '--- source_position_id integrity (expect 0 orphans) ---'
SELECT COUNT(*) AS orphan_source_position_ids
FROM weekly_review_items wri
JOIN weekly_reviews wr ON wr.id = wri.review_id
WHERE wr.user_id = 'bef6cbae-545c-4a26-8026-b02749bcdf56'
  AND wri.source_position_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM portfolio_positions_db pos
      WHERE pos.id = wri.source_position_id
        AND pos.user_id = 'bef6cbae-545c-4a26-8026-b02749bcdf56'
  );

-- ---------------------------------------------------------------------------
-- 5. Confirm Admin data is unchanged (spot check)
-- ---------------------------------------------------------------------------
\echo ''
\echo '--- admin data integrity spot check (counts must be unchanged) ---'
SELECT
    (SELECT COUNT(*) FROM portfolios           WHERE user_id = 'aa433282-379c-49a3-8eb7-fffe9bafa60d') AS admin_portfolios,
    (SELECT COUNT(*) FROM portfolio_positions_db WHERE user_id = 'aa433282-379c-49a3-8eb7-fffe9bafa60d') AS admin_positions,
    (SELECT COUNT(*) FROM action_plans         WHERE created_by = 'aa433282-379c-49a3-8eb7-fffe9bafa60d') AS admin_plans,
    (SELECT COUNT(*) FROM weekly_reviews       WHERE user_id = 'aa433282-379c-49a3-8eb7-fffe9bafa60d') AS admin_reviews,
    (SELECT COUNT(*) FROM pe_scan_results      WHERE user_id = 'aa433282-379c-49a3-8eb7-fffe9bafa60d') AS admin_pe_results;

\echo ''
\echo '======================================================================='
\echo '  Verification complete.'
\echo '  Expected: admin counts unchanged, pop counts = admin counts, 0 orphans'
\echo '======================================================================='
