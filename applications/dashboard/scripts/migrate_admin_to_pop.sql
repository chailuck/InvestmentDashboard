-- =============================================================================
-- migrate_admin_to_pop.sql
-- Investment Dashboard — one-time data migration
--
-- PURPOSE
--   Copy all data owned by the Admin user to the Pop user, then switch Pop's
--   portfolio_mode to 'db'.  Admin data is never touched.
--
-- PRECONDITIONS (verified before running)
--   Admin  id = aa433282-379c-49a3-8eb7-fffe9bafa60d  email = admin@demo.com
--   Pop    id = bef6cbae-545c-4a26-8026-b02749bcdf56  email = chailuck@gmail.com
--   Pop currently has ZERO rows in all tables below — no conflict risk.
--
-- HOW TO RUN (inside the container)
--   docker cp migrate_admin_to_pop.sql inv_postgres:/tmp/migrate_admin_to_pop.sql
--   docker exec inv_postgres psql -U postgres -d investment_db \
--          -f /tmp/migrate_admin_to_pop.sql
--
-- ROLLBACK
--   The script is wrapped in a single transaction.  If any statement fails,
--   Postgres automatically rolls back the entire transaction — the database is
--   left unchanged.  Manual rollback: see ROLLBACK PLAN section at the bottom.
--
-- DATABASE   : PostgreSQL 16
-- EXTENSION  : uuid-ossp (pre-installed via init_db.sql)
-- =============================================================================

\set ON_ERROR_STOP on
\timing on

BEGIN;

-- ---------------------------------------------------------------------------
-- CONSTANTS — pin user IDs so the script is self-documenting
-- ---------------------------------------------------------------------------
DO $$ BEGIN
    RAISE NOTICE '=== Investment Dashboard: Admin → Pop migration started at % ===', now();
END $$;

-- ---------------------------------------------------------------------------
-- GUARD: abort early if Pop already has data, preventing a double-run
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_portfolio_count INT;
BEGIN
    SELECT COUNT(*) INTO v_portfolio_count
    FROM portfolios
    WHERE user_id = 'bef6cbae-545c-4a26-8026-b02749bcdf56';

    IF v_portfolio_count > 0 THEN
        RAISE EXCEPTION
            'ABORT: Pop user already has % portfolio(s). '
            'This script is idempotent-safe only when Pop has zero data. '
            'If you need to re-run, first manually delete Pop''s data or '
            'restore from a backup. Rolling back.',
            v_portfolio_count;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- STEP 1 — Build portfolio ID mapping
--          Admin portfolio id  →  new Pop portfolio id
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE tmp_portfolio_map (
    old_id  UUID NOT NULL,
    new_id  UUID NOT NULL DEFAULT uuid_generate_v4()
) ON COMMIT DROP;

INSERT INTO tmp_portfolio_map (old_id)
SELECT id FROM portfolios
WHERE user_id = 'aa433282-379c-49a3-8eb7-fffe9bafa60d';

DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT old_id, new_id FROM tmp_portfolio_map LOOP
        RAISE NOTICE '  portfolio map: % → %', r.old_id, r.new_id;
    END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- STEP 2 — Build position ID mapping
--          Admin position id  →  new Pop position id
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE tmp_position_map (
    old_id  UUID NOT NULL,
    new_id  UUID NOT NULL DEFAULT uuid_generate_v4()
) ON COMMIT DROP;

INSERT INTO tmp_position_map (old_id)
SELECT id FROM portfolio_positions_db
WHERE user_id = 'aa433282-379c-49a3-8eb7-fffe9bafa60d';

DO $$ BEGIN
    RAISE NOTICE '  position map rows: %',
        (SELECT COUNT(*) FROM tmp_position_map);
END $$;

-- ---------------------------------------------------------------------------
-- STEP 3 — Build symbol-list ID mapping
--          Admin user_symbol_list id  →  new Pop user_symbol_list id
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE tmp_symbol_list_map (
    old_id  UUID NOT NULL,
    new_id  UUID NOT NULL DEFAULT uuid_generate_v4()
) ON COMMIT DROP;

INSERT INTO tmp_symbol_list_map (old_id)
SELECT id FROM user_symbol_lists
WHERE user_id = 'aa433282-379c-49a3-8eb7-fffe9bafa60d';

DO $$ BEGIN
    RAISE NOTICE '  symbol_list map rows: %',
        (SELECT COUNT(*) FROM tmp_symbol_list_map);
END $$;

-- ---------------------------------------------------------------------------
-- STEP 4 — Build weekly-scan ID mapping
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE tmp_scan_map (
    old_id  UUID NOT NULL,
    new_id  UUID NOT NULL DEFAULT uuid_generate_v4()
) ON COMMIT DROP;

INSERT INTO tmp_scan_map (old_id)
SELECT id FROM weekly_scans
WHERE user_id = 'aa433282-379c-49a3-8eb7-fffe9bafa60d';

DO $$ BEGIN
    RAISE NOTICE '  scan map rows: %',
        (SELECT COUNT(*) FROM tmp_scan_map);
END $$;

-- ---------------------------------------------------------------------------
-- STEP 5 — Build action-plan ID mapping
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE tmp_plan_map (
    old_id  UUID NOT NULL,
    new_id  UUID NOT NULL DEFAULT uuid_generate_v4()
) ON COMMIT DROP;

INSERT INTO tmp_plan_map (old_id)
SELECT id FROM action_plans
WHERE created_by = 'aa433282-379c-49a3-8eb7-fffe9bafa60d';

DO $$ BEGIN
    RAISE NOTICE '  action_plan map rows: %',
        (SELECT COUNT(*) FROM tmp_plan_map);
END $$;

-- ---------------------------------------------------------------------------
-- STEP 6 — Build weekly-review ID mapping
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE tmp_review_map (
    old_id  UUID NOT NULL,
    new_id  UUID NOT NULL DEFAULT uuid_generate_v4()
) ON COMMIT DROP;

INSERT INTO tmp_review_map (old_id)
SELECT id FROM weekly_reviews
WHERE user_id = 'aa433282-379c-49a3-8eb7-fffe9bafa60d';

DO $$ BEGIN
    RAISE NOTICE '  weekly_review map rows: %',
        (SELECT COUNT(*) FROM tmp_review_map);
END $$;

-- ===========================================================================
-- DATA COPY — one section per table, ordered by FK dependency
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- TABLE: portfolios
-- ---------------------------------------------------------------------------
INSERT INTO portfolios (
    id, user_id, name, description, currency, benchmark_symbol,
    cash, is_default, portfolio_mode, excel_source_path, excel_working_path,
    sort_order, created_at, updated_at
)
SELECT
    m.new_id,
    'bef6cbae-545c-4a26-8026-b02749bcdf56',   -- Pop's user_id
    p.name,
    p.description,
    p.currency,
    p.benchmark_symbol,
    p.cash,
    p.is_default,
    -- Copy the original mode; we will normalise everything to 'db' in STEP 13
    p.portfolio_mode,
    -- Excel paths are intentionally NULL — Pop will use db mode
    NULL,
    NULL,
    p.sort_order,
    p.created_at,
    p.updated_at
FROM portfolios p
JOIN tmp_portfolio_map m ON m.old_id = p.id
WHERE p.user_id = 'aa433282-379c-49a3-8eb7-fffe9bafa60d'
ON CONFLICT DO NOTHING;

DO $$ BEGIN
    RAISE NOTICE '  portfolios inserted: %',
        (SELECT COUNT(*) FROM portfolios WHERE user_id = 'bef6cbae-545c-4a26-8026-b02749bcdf56');
END $$;

-- ---------------------------------------------------------------------------
-- TABLE: holdings  (Admin has 0 rows — insert is a no-op but safe)
-- ---------------------------------------------------------------------------
INSERT INTO holdings (
    id, portfolio_id, symbol, name, quantity, avg_cost,
    sector, asset_class, created_at, updated_at
)
SELECT
    uuid_generate_v4(),
    m.new_id,
    h.symbol,
    h.name,
    h.quantity,
    h.avg_cost,
    h.sector,
    h.asset_class,
    h.created_at,
    h.updated_at
FROM holdings h
JOIN portfolios p         ON p.id = h.portfolio_id
JOIN tmp_portfolio_map m  ON m.old_id = p.id
WHERE p.user_id = 'aa433282-379c-49a3-8eb7-fffe9bafa60d'
ON CONFLICT DO NOTHING;

DO $$ BEGIN
    RAISE NOTICE '  holdings inserted: %',
        (SELECT COUNT(*) FROM holdings
         WHERE portfolio_id IN (SELECT new_id FROM tmp_portfolio_map));
END $$;

-- ---------------------------------------------------------------------------
-- TABLE: investment_transactions
-- ---------------------------------------------------------------------------
INSERT INTO investment_transactions (
    id, portfolio_id, user_id, date, action, amount,
    currency, note, created_at, updated_at
)
SELECT
    uuid_generate_v4(),
    m.new_id,
    'bef6cbae-545c-4a26-8026-b02749bcdf56',
    t.date,
    t.action,
    t.amount,
    t.currency,
    t.note,
    t.created_at,
    t.updated_at
FROM investment_transactions t
JOIN tmp_portfolio_map m ON m.old_id = t.portfolio_id
WHERE t.user_id = 'aa433282-379c-49a3-8eb7-fffe9bafa60d'
ON CONFLICT DO NOTHING;

DO $$ BEGIN
    RAISE NOTICE '  investment_transactions inserted: %',
        (SELECT COUNT(*) FROM investment_transactions
         WHERE user_id = 'bef6cbae-545c-4a26-8026-b02749bcdf56');
END $$;

-- ---------------------------------------------------------------------------
-- TABLE: portfolio_positions_db
--
-- parent_id is always NULL for Admin's data (confirmed in audit).
-- The mapping table is still used for source_position_id remapping later.
-- If parent_id were non-NULL, the self-referential FK would require a
-- two-pass approach; that complexity is avoided here because parent_id = NULL.
-- ---------------------------------------------------------------------------
INSERT INTO portfolio_positions_db (
    id, user_id, symbol, direction, entry_date, entry_price,
    position_size, sl, tp, status, exit_date, exit_price,
    remarks, portfolio_id, parent_id, created_at, updated_at
)
SELECT
    pm.new_id,
    'bef6cbae-545c-4a26-8026-b02749bcdf56',
    pos.symbol,
    pos.direction,
    pos.entry_date,
    pos.entry_price,
    pos.position_size,
    pos.sl,
    pos.tp,
    pos.status,
    pos.exit_date,
    pos.exit_price,
    pos.remarks,
    -- remap portfolio FK (may be NULL if original position has no portfolio)
    portm.new_id,
    -- parent_id: remap if non-NULL, else keep NULL
    CASE
        WHEN pos.parent_id IS NULL THEN NULL
        ELSE (SELECT new_id FROM tmp_position_map WHERE old_id = pos.parent_id)
    END,
    pos.created_at,
    pos.updated_at
FROM portfolio_positions_db pos
JOIN tmp_position_map   pm    ON pm.old_id   = pos.id
LEFT JOIN tmp_portfolio_map portm ON portm.old_id = pos.portfolio_id
WHERE pos.user_id = 'aa433282-379c-49a3-8eb7-fffe9bafa60d'
ON CONFLICT DO NOTHING;

DO $$ BEGIN
    RAISE NOTICE '  portfolio_positions_db inserted: %',
        (SELECT COUNT(*) FROM portfolio_positions_db
         WHERE user_id = 'bef6cbae-545c-4a26-8026-b02749bcdf56');
END $$;

-- ---------------------------------------------------------------------------
-- TABLE: action_plans
-- ---------------------------------------------------------------------------
INSERT INTO action_plans (
    id, name, plan_type, created_by,
    notes, set_analysis, ai_recommend, created_at, updated_at
)
SELECT
    m.new_id,
    ap.name,
    ap.plan_type,
    'bef6cbae-545c-4a26-8026-b02749bcdf56',
    ap.notes,
    ap.set_analysis,
    ap.ai_recommend,
    ap.created_at,
    ap.updated_at
FROM action_plans ap
JOIN tmp_plan_map m ON m.old_id = ap.id
WHERE ap.created_by = 'aa433282-379c-49a3-8eb7-fffe9bafa60d'
ON CONFLICT DO NOTHING;

DO $$ BEGIN
    RAISE NOTICE '  action_plans inserted: %',
        (SELECT COUNT(*) FROM action_plans
         WHERE created_by = 'bef6cbae-545c-4a26-8026-b02749bcdf56');
END $$;

-- ---------------------------------------------------------------------------
-- TABLE: purchase_plan_items
-- ---------------------------------------------------------------------------
INSERT INTO purchase_plan_items (
    id, plan_id, sort_order, stock, current_price, size,
    buy_price, tp, sl, strategy, reason, triggered,
    created_at, updated_at
)
SELECT
    uuid_generate_v4(),
    m.new_id,
    ppi.sort_order,
    ppi.stock,
    ppi.current_price,
    ppi.size,
    ppi.buy_price,
    ppi.tp,
    ppi.sl,
    ppi.strategy,
    ppi.reason,
    ppi.triggered,
    ppi.created_at,
    ppi.updated_at
FROM purchase_plan_items ppi
JOIN tmp_plan_map m ON m.old_id = ppi.plan_id
ON CONFLICT DO NOTHING;

DO $$ BEGIN
    RAISE NOTICE '  purchase_plan_items inserted: %',
        (SELECT COUNT(*) FROM purchase_plan_items
         WHERE plan_id IN (SELECT new_id FROM tmp_plan_map));
END $$;

-- ---------------------------------------------------------------------------
-- TABLE: portfolio_plan_items
-- ---------------------------------------------------------------------------
INSERT INTO portfolio_plan_items (
    id, plan_id, sort_order, symbol, current_price, size,
    entry_price, tp, sl, order_size, created_at, updated_at
)
SELECT
    uuid_generate_v4(),
    m.new_id,
    ppi.sort_order,
    ppi.symbol,
    ppi.current_price,
    ppi.size,
    ppi.entry_price,
    ppi.tp,
    ppi.sl,
    ppi.order_size,
    ppi.created_at,
    ppi.updated_at
FROM portfolio_plan_items ppi
JOIN tmp_plan_map m ON m.old_id = ppi.plan_id
ON CONFLICT DO NOTHING;

DO $$ BEGIN
    RAISE NOTICE '  portfolio_plan_items inserted: %',
        (SELECT COUNT(*) FROM portfolio_plan_items
         WHERE plan_id IN (SELECT new_id FROM tmp_plan_map));
END $$;

-- ---------------------------------------------------------------------------
-- TABLE: user_scan_configs
--
-- This table has a UNIQUE constraint on user_id (one row per user).
-- We copy the Admin row and assign Pop's user_id.
-- ON CONFLICT DO NOTHING protects against a double-run once guard is bypassed.
-- ---------------------------------------------------------------------------
INSERT INTO user_scan_configs (id, user_id, symbols, updated_at)
SELECT
    uuid_generate_v4(),
    'bef6cbae-545c-4a26-8026-b02749bcdf56',
    usc.symbols,
    usc.updated_at
FROM user_scan_configs usc
WHERE usc.user_id = 'aa433282-379c-49a3-8eb7-fffe9bafa60d'
ON CONFLICT (user_id) DO NOTHING;

DO $$ BEGIN
    RAISE NOTICE '  user_scan_configs inserted: %',
        (SELECT COUNT(*) FROM user_scan_configs
         WHERE user_id = 'bef6cbae-545c-4a26-8026-b02749bcdf56');
END $$;

-- ---------------------------------------------------------------------------
-- TABLE: user_symbol_lists
-- ---------------------------------------------------------------------------
INSERT INTO user_symbol_lists (
    id, user_id, name, market, is_dr, symbols,
    sort_order, created_at, updated_at
)
SELECT
    m.new_id,
    'bef6cbae-545c-4a26-8026-b02749bcdf56',
    usl.name,
    usl.market,
    usl.is_dr,
    usl.symbols,
    usl.sort_order,
    usl.created_at,
    usl.updated_at
FROM user_symbol_lists usl
JOIN tmp_symbol_list_map m ON m.old_id = usl.id
WHERE usl.user_id = 'aa433282-379c-49a3-8eb7-fffe9bafa60d'
ON CONFLICT DO NOTHING;

DO $$ BEGIN
    RAISE NOTICE '  user_symbol_lists inserted: %',
        (SELECT COUNT(*) FROM user_symbol_lists
         WHERE user_id = 'bef6cbae-545c-4a26-8026-b02749bcdf56');
END $$;

-- ---------------------------------------------------------------------------
-- TABLE: weekly_scans
-- ---------------------------------------------------------------------------
INSERT INTO weekly_scans (id, user_id, name, created_at, updated_at)
SELECT
    m.new_id,
    'bef6cbae-545c-4a26-8026-b02749bcdf56',
    ws.name,
    ws.created_at,
    ws.updated_at
FROM weekly_scans ws
JOIN tmp_scan_map m ON m.old_id = ws.id
WHERE ws.user_id = 'aa433282-379c-49a3-8eb7-fffe9bafa60d'
ON CONFLICT DO NOTHING;

DO $$ BEGIN
    RAISE NOTICE '  weekly_scans inserted: %',
        (SELECT COUNT(*) FROM weekly_scans
         WHERE user_id = 'bef6cbae-545c-4a26-8026-b02749bcdf56');
END $$;

-- ---------------------------------------------------------------------------
-- TABLE: weekly_scan_items
-- (unique constraint: scan_id + symbol)
-- ---------------------------------------------------------------------------
INSERT INTO weekly_scan_items (
    id, scan_id, symbol, sort_order, list_name, market,
    color_mark, strategy, buy_price, size, tp, sl, remark, updated_at
)
SELECT
    uuid_generate_v4(),
    sm.new_id,
    wsi.symbol,
    wsi.sort_order,
    wsi.list_name,
    wsi.market,
    wsi.color_mark,
    wsi.strategy,
    wsi.buy_price,
    wsi.size,
    wsi.tp,
    wsi.sl,
    wsi.remark,
    wsi.updated_at
FROM weekly_scan_items wsi
JOIN tmp_scan_map sm ON sm.old_id = wsi.scan_id
ON CONFLICT (scan_id, symbol) DO NOTHING;

DO $$ BEGIN
    RAISE NOTICE '  weekly_scan_items inserted: %',
        (SELECT COUNT(*) FROM weekly_scan_items
         WHERE scan_id IN (SELECT new_id FROM tmp_scan_map));
END $$;

-- ---------------------------------------------------------------------------
-- TABLE: pe_scan_results
-- (unique constraint: user_id + list_id + symbol)
-- ---------------------------------------------------------------------------
INSERT INTO pe_scan_results (
    id, user_id, list_id, symbol, indicator,
    current_price, change_pct, points_json, refreshed_at
)
SELECT
    uuid_generate_v4(),
    'bef6cbae-545c-4a26-8026-b02749bcdf56',
    slm.new_id,
    psr.symbol,
    psr.indicator,
    psr.current_price,
    psr.change_pct,
    psr.points_json,
    psr.refreshed_at
FROM pe_scan_results psr
JOIN tmp_symbol_list_map slm ON slm.old_id = psr.list_id
WHERE psr.user_id = 'aa433282-379c-49a3-8eb7-fffe9bafa60d'
ON CONFLICT (user_id, list_id, symbol) DO NOTHING;

DO $$ BEGIN
    RAISE NOTICE '  pe_scan_results inserted: %',
        (SELECT COUNT(*) FROM pe_scan_results
         WHERE user_id = 'bef6cbae-545c-4a26-8026-b02749bcdf56');
END $$;

-- ---------------------------------------------------------------------------
-- TABLE: symbol_notes  (Admin has 0 rows — no-op but safe)
-- ---------------------------------------------------------------------------
-- No model-defined unique constraint other than PK; we generate a fresh PK.
-- symbol_notes has: id, user_id, symbol, note, updated_at (no created_at column)
INSERT INTO symbol_notes (id, user_id, symbol, note, updated_at)
SELECT
    uuid_generate_v4(),
    'bef6cbae-545c-4a26-8026-b02749bcdf56',
    sn.symbol,
    sn.note,
    sn.updated_at
FROM symbol_notes sn
WHERE sn.user_id = 'aa433282-379c-49a3-8eb7-fffe9bafa60d'
ON CONFLICT DO NOTHING;

DO $$ BEGIN
    RAISE NOTICE '  symbol_notes inserted: %',
        (SELECT COUNT(*) FROM symbol_notes
         WHERE user_id = 'bef6cbae-545c-4a26-8026-b02749bcdf56');
END $$;

-- ---------------------------------------------------------------------------
-- TABLE: weekly_reviews
-- (unique constraint: user_id + week_start)
-- ---------------------------------------------------------------------------
INSERT INTO weekly_reviews (
    id, user_id, week_start, week_end, name,
    notes, created_at, updated_at
)
SELECT
    m.new_id,
    'bef6cbae-545c-4a26-8026-b02749bcdf56',
    wr.week_start,
    wr.week_end,
    wr.name,
    wr.notes,
    wr.created_at,
    wr.updated_at
FROM weekly_reviews wr
JOIN tmp_review_map m ON m.old_id = wr.id
WHERE wr.user_id = 'aa433282-379c-49a3-8eb7-fffe9bafa60d'
ON CONFLICT (user_id, week_start) DO NOTHING;

DO $$ BEGIN
    RAISE NOTICE '  weekly_reviews inserted: %',
        (SELECT COUNT(*) FROM weekly_reviews
         WHERE user_id = 'bef6cbae-545c-4a26-8026-b02749bcdf56');
END $$;

-- ---------------------------------------------------------------------------
-- TABLE: weekly_review_items
--
-- source_position_id must be remapped:
--   if the old Admin position_id exists in tmp_position_map → use new Pop id
--   if it is NULL or not found → NULL
-- ---------------------------------------------------------------------------
INSERT INTO weekly_review_items (
    id, review_id, symbol, item_type,
    buy_date, buy_price, buy_size,
    sell_date, sell_price, sell_size,
    buy_reason, buy_feeling,
    sell_reason, sell_feeling,
    week_open_price, week_close_price,
    source_position_id,
    sort_order, created_at, updated_at
)
SELECT
    uuid_generate_v4(),
    rm.new_id,
    wri.symbol,
    wri.item_type,
    wri.buy_date,
    wri.buy_price,
    wri.buy_size,
    wri.sell_date,
    wri.sell_price,
    wri.sell_size,
    wri.buy_reason,
    wri.buy_feeling,
    wri.sell_reason,
    wri.sell_feeling,
    wri.week_open_price,
    wri.week_close_price,
    -- Remap source_position_id; fall back to NULL if not found
    (SELECT pm.new_id
     FROM tmp_position_map pm
     WHERE pm.old_id = wri.source_position_id),
    wri.sort_order,
    wri.created_at,
    wri.updated_at
FROM weekly_review_items wri
JOIN tmp_review_map rm ON rm.old_id = wri.review_id
ON CONFLICT DO NOTHING;

DO $$ BEGIN
    RAISE NOTICE '  weekly_review_items inserted: %',
        (SELECT COUNT(*) FROM weekly_review_items
         WHERE review_id IN (SELECT new_id FROM tmp_review_map));
END $$;

-- ===========================================================================
-- STEP 13 — Switch Pop to portfolio_mode = 'db'
-- ===========================================================================

-- Update Pop's user record
UPDATE users
SET
    portfolio_mode     = 'db',
    excel_source_path  = NULL,
    excel_working_path = NULL,
    updated_at         = now()
WHERE id = 'bef6cbae-545c-4a26-8026-b02749bcdf56';

DO $$ BEGIN
    RAISE NOTICE '  users.portfolio_mode updated for Pop: %',
        (SELECT portfolio_mode FROM users
         WHERE id = 'bef6cbae-545c-4a26-8026-b02749bcdf56');
END $$;

-- Update all of Pop's portfolio records to mode = 'db'
UPDATE portfolios
SET
    portfolio_mode     = 'db',
    excel_source_path  = NULL,
    excel_working_path = NULL,
    updated_at         = now()
WHERE user_id = 'bef6cbae-545c-4a26-8026-b02749bcdf56';

DO $$ BEGIN
    RAISE NOTICE '  portfolios updated to db mode for Pop: %',
        (SELECT COUNT(*) FROM portfolios
         WHERE user_id = 'bef6cbae-545c-4a26-8026-b02749bcdf56'
           AND portfolio_mode = 'db');
END $$;

-- ===========================================================================
-- FINAL NOTICE
-- ===========================================================================
DO $$ BEGIN
    RAISE NOTICE '=== Migration completed successfully at % ===', now();
    RAISE NOTICE 'Run the verification queries to confirm row counts.';
END $$;

COMMIT;
