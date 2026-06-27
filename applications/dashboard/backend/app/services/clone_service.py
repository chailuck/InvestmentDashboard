"""Clone-user service — copies all user-owned data from one user to another.

All writes are executed inside a single atomic transaction.  FK execution order
is strictly enforced so that parent rows always exist before children are
inserted.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.action_plan import ActionPlan, PortfolioPlanItem, PurchasePlanItem
from app.models.portfolio import Holding, InvestmentTransaction, Portfolio
from app.models.portfolio_db import PortfolioDbPosition
from app.models.symbol_note import SymbolNote
from app.models.user import User
from app.models.weekly_review import WeeklyReview, WeeklyReviewItem
from app.models.weekly_scan import (
    PeScanResult,
    UserScanConfig,
    UserSymbolList,
    WeeklyScan,
    WeeklyScanItem,
)
from app.schemas.users import CloneExecuteResponse, ClonePreflightResponse, TableCounts

_log = get_logger("services.clone_service")


# ── Internal helpers ──────────────────────────────────────────────────────────

async def _count_via_fk(db: AsyncSession, model, fk_col, user_id: uuid.UUID) -> int:
    """Count rows for a model that has a direct FK column pointing to users.id."""
    from sqlalchemy import func as sqlfunc
    result = await db.execute(
        select(sqlfunc.count()).select_from(model).where(fk_col == user_id)
    )
    return result.scalar_one()


async def _count_via_join(
    db: AsyncSession,
    child_model,
    child_fk_col,
    parent_model,
    parent_user_fk_col,
    user_id: uuid.UUID,
) -> int:
    """Count child rows whose parent belongs to the given user.

    Used for holdings, plan items, scan items, review items, etc.
    """
    from sqlalchemy import func as sqlfunc
    result = await db.execute(
        select(sqlfunc.count())
        .select_from(child_model)
        .join(parent_model, child_fk_col == parent_model.id)
        .where(parent_user_fk_col == user_id)
    )
    return result.scalar_one()


async def _build_source_counts(db: AsyncSession, user_id: uuid.UUID) -> TableCounts:
    portfolios = await _count_via_fk(db, Portfolio, Portfolio.user_id, user_id)
    holdings = await _count_via_join(db, Holding, Holding.portfolio_id, Portfolio, Portfolio.user_id, user_id)
    investment_transactions = await _count_via_fk(db, InvestmentTransaction, InvestmentTransaction.user_id, user_id)
    portfolio_positions_db = await _count_via_fk(db, PortfolioDbPosition, PortfolioDbPosition.user_id, user_id)
    action_plans = await _count_via_fk(db, ActionPlan, ActionPlan.created_by, user_id)
    purchase_plan_items = await _count_via_join(
        db, PurchasePlanItem, PurchasePlanItem.plan_id, ActionPlan, ActionPlan.created_by, user_id
    )
    portfolio_plan_items = await _count_via_join(
        db, PortfolioPlanItem, PortfolioPlanItem.plan_id, ActionPlan, ActionPlan.created_by, user_id
    )
    user_scan_configs = await _count_via_fk(db, UserScanConfig, UserScanConfig.user_id, user_id)
    user_symbol_lists = await _count_via_fk(db, UserSymbolList, UserSymbolList.user_id, user_id)
    weekly_scans = await _count_via_fk(db, WeeklyScan, WeeklyScan.user_id, user_id)
    weekly_scan_items = await _count_via_join(
        db, WeeklyScanItem, WeeklyScanItem.scan_id, WeeklyScan, WeeklyScan.user_id, user_id
    )
    pe_scan_results = await _count_via_fk(db, PeScanResult, PeScanResult.user_id, user_id)
    symbol_notes = await _count_via_fk(db, SymbolNote, SymbolNote.user_id, user_id)
    weekly_reviews = await _count_via_fk(db, WeeklyReview, WeeklyReview.user_id, user_id)
    weekly_review_items = await _count_via_join(
        db, WeeklyReviewItem, WeeklyReviewItem.review_id, WeeklyReview, WeeklyReview.user_id, user_id
    )

    return TableCounts(
        portfolios=portfolios,
        holdings=holdings,
        investment_transactions=investment_transactions,
        portfolio_positions_db=portfolio_positions_db,
        action_plans=action_plans,
        purchase_plan_items=purchase_plan_items,
        portfolio_plan_items=portfolio_plan_items,
        user_scan_configs=user_scan_configs,
        user_symbol_lists=user_symbol_lists,
        weekly_scans=weekly_scans,
        weekly_scan_items=weekly_scan_items,
        pe_scan_results=pe_scan_results,
        symbol_notes=symbol_notes,
        weekly_reviews=weekly_reviews,
        weekly_review_items=weekly_review_items,
    )


# ── Public API ────────────────────────────────────────────────────────────────

async def run_clone_preflight(
    db: AsyncSession,
    source: User,
    target: User,
) -> ClonePreflightResponse:
    """Read-only preflight — count rows for both users across all 15 tables."""
    source_id = source.id
    target_id = target.id

    source_counts = await _build_source_counts(db, source_id)
    target_counts = await _build_source_counts(db, target_id)

    total_target = sum(target_counts.model_dump().values())

    return ClonePreflightResponse(
        source_user_id=str(source_id),
        source_user_name=source.name,
        target_user_id=str(target_id),
        target_user_name=target.name,
        source_counts=source_counts,
        target_existing_counts=target_counts,
        target_has_data=(total_target > 0),
    )


async def run_clone(
    db: AsyncSession,
    admin: User,
    source: User,
    target: User,
    portfolio_mode: str,
) -> CloneExecuteResponse:
    """Execute full clone inside a single atomic transaction.

    The FK execution order below must NOT be changed — each step depends on ID
    maps built by the steps that precede it.
    """
    source_id = source.id
    target_id = target.id

    _log.info(
        "clone.started",
        admin_id=str(admin.id),
        source_id=str(source_id),
        target_id=str(target_id),
        portfolio_mode=portfolio_mode,
    )

    rows = TableCounts()

    async with db.begin():
        # ── Update target portfolio_mode first ───────────────────────────────
        target.portfolio_mode = portfolio_mode

        # ────────────────────────────────────────────────────────────────────
        # Step 1: portfolios
        # UNIQUE on (user_id, name) — deduplicate names before inserting.
        # ────────────────────────────────────────────────────────────────────
        existing_target_portfolio_names: set[str] = set(
            row[0]
            for row in (
                await db.execute(
                    select(Portfolio.name).where(Portfolio.user_id == target_id)
                )
            ).all()
        )

        src_portfolios = (
            await db.execute(select(Portfolio).where(Portfolio.user_id == source_id))
        ).scalars().all()

        portfolio_id_map: dict[uuid.UUID, uuid.UUID] = {}

        for src_p in src_portfolios:
            new_id = uuid.uuid4()
            portfolio_id_map[src_p.id] = new_id

            cloned_name = src_p.name
            if cloned_name in existing_target_portfolio_names:
                cloned_name = f"{cloned_name} (cloned)"
            existing_target_portfolio_names.add(cloned_name)

            db.add(Portfolio(
                id=new_id,
                user_id=target_id,
                name=cloned_name,
                description=src_p.description,
                currency=src_p.currency,
                benchmark_symbol=src_p.benchmark_symbol,
                cash=src_p.cash,
                is_default=src_p.is_default,
                portfolio_mode=portfolio_mode,
                excel_source_path=src_p.excel_source_path,
                excel_working_path=src_p.excel_working_path,
                sort_order=src_p.sort_order,
            ))
            rows.portfolios += 1

        # ────────────────────────────────────────────────────────────────────
        # Step 2: action_plans  (FK column is created_by, not user_id)
        # ────────────────────────────────────────────────────────────────────
        src_plans = (
            await db.execute(
                select(ActionPlan).where(ActionPlan.created_by == source_id)
            )
        ).scalars().all()

        plan_id_map: dict[uuid.UUID, uuid.UUID] = {}

        for src_plan in src_plans:
            new_id = uuid.uuid4()
            plan_id_map[src_plan.id] = new_id
            db.add(ActionPlan(
                id=new_id,
                name=src_plan.name,
                plan_type=src_plan.plan_type,
                created_by=target_id,
                notes=src_plan.notes,
                set_analysis=src_plan.set_analysis,
                ai_recommend=src_plan.ai_recommend,
            ))
            rows.action_plans += 1

        # ────────────────────────────────────────────────────────────────────
        # Step 3: user_scan_configs  (UNIQUE on user_id — update if exists)
        # ────────────────────────────────────────────────────────────────────
        src_config = (
            await db.execute(
                select(UserScanConfig).where(UserScanConfig.user_id == source_id)
            )
        ).scalar_one_or_none()

        if src_config is not None:
            existing_config = (
                await db.execute(
                    select(UserScanConfig).where(UserScanConfig.user_id == target_id)
                )
            ).scalar_one_or_none()

            if existing_config is not None:
                existing_config.symbols = list(src_config.symbols)
            else:
                db.add(UserScanConfig(
                    id=uuid.uuid4(),
                    user_id=target_id,
                    symbols=list(src_config.symbols),
                ))
            rows.user_scan_configs += 1

        # ────────────────────────────────────────────────────────────────────
        # Step 4: user_symbol_lists
        # ────────────────────────────────────────────────────────────────────
        src_symbol_lists = (
            await db.execute(
                select(UserSymbolList).where(UserSymbolList.user_id == source_id)
            )
        ).scalars().all()

        symbol_list_id_map: dict[uuid.UUID, uuid.UUID] = {}

        for src_sl in src_symbol_lists:
            new_id = uuid.uuid4()
            symbol_list_id_map[src_sl.id] = new_id
            db.add(UserSymbolList(
                id=new_id,
                user_id=target_id,
                name=src_sl.name,
                market=src_sl.market,
                is_dr=src_sl.is_dr,
                symbols=list(src_sl.symbols),
                sort_order=src_sl.sort_order,
            ))
            rows.user_symbol_lists += 1

        # ────────────────────────────────────────────────────────────────────
        # Step 5: weekly_scans
        # ────────────────────────────────────────────────────────────────────
        src_scans = (
            await db.execute(
                select(WeeklyScan).where(WeeklyScan.user_id == source_id)
            )
        ).scalars().all()

        scan_id_map: dict[uuid.UUID, uuid.UUID] = {}

        for src_scan in src_scans:
            new_id = uuid.uuid4()
            scan_id_map[src_scan.id] = new_id
            db.add(WeeklyScan(
                id=new_id,
                user_id=target_id,
                name=src_scan.name,
            ))
            rows.weekly_scans += 1

        # ────────────────────────────────────────────────────────────────────
        # Step 6: pe_scan_results  (FK to user_symbol_lists via list_id)
        # Skip rows whose list_id cannot be remapped with WARNING.
        # ────────────────────────────────────────────────────────────────────
        src_pe_results = (
            await db.execute(
                select(PeScanResult).where(PeScanResult.user_id == source_id)
            )
        ).scalars().all()

        for src_pe in src_pe_results:
            new_list_id = symbol_list_id_map.get(src_pe.list_id)
            if new_list_id is None:
                _log.warning(
                    "clone.pe_scan_result.unmapped_list_id",
                    source_pe_id=str(src_pe.id),
                    source_list_id=str(src_pe.list_id),
                    target_id=str(target_id),
                )
                continue
            db.add(PeScanResult(
                id=uuid.uuid4(),
                user_id=target_id,
                list_id=new_list_id,
                symbol=src_pe.symbol,
                indicator=src_pe.indicator,
                current_price=src_pe.current_price,
                change_pct=src_pe.change_pct,
                points_json=list(src_pe.points_json),
            ))
            rows.pe_scan_results += 1

        # ────────────────────────────────────────────────────────────────────
        # Step 7: symbol_notes  (UNIQUE on (user_id, symbol))
        # Pre-fetch target symbols to detect collisions; skip on collision.
        # ────────────────────────────────────────────────────────────────────
        existing_target_symbols: set[str] = set(
            row[0]
            for row in (
                await db.execute(
                    select(SymbolNote.symbol).where(SymbolNote.user_id == target_id)
                )
            ).all()
        )

        src_notes = (
            await db.execute(
                select(SymbolNote).where(SymbolNote.user_id == source_id)
            )
        ).scalars().all()

        for src_note in src_notes:
            if src_note.symbol in existing_target_symbols:
                _log.debug(
                    "clone.symbol_note.skipped_collision",
                    symbol=src_note.symbol,
                    target_id=str(target_id),
                )
                continue
            existing_target_symbols.add(src_note.symbol)
            db.add(SymbolNote(
                id=uuid.uuid4(),
                user_id=target_id,
                symbol=src_note.symbol,
                note=src_note.note,
            ))
            rows.symbol_notes += 1

        # ────────────────────────────────────────────────────────────────────
        # Step 8: weekly_reviews  (UNIQUE on (user_id, week_start))
        # Build review_id_map only for non-skipped rows.
        # ────────────────────────────────────────────────────────────────────
        existing_target_week_starts: set = set(
            row[0]
            for row in (
                await db.execute(
                    select(WeeklyReview.week_start).where(WeeklyReview.user_id == target_id)
                )
            ).all()
        )

        src_reviews = (
            await db.execute(
                select(WeeklyReview).where(WeeklyReview.user_id == source_id)
            )
        ).scalars().all()

        review_id_map: dict[uuid.UUID, uuid.UUID] = {}
        skipped_review_ids: set[uuid.UUID] = set()

        for src_review in src_reviews:
            if src_review.week_start in existing_target_week_starts:
                _log.debug(
                    "clone.weekly_review.skipped_collision",
                    week_start=str(src_review.week_start),
                    source_review_id=str(src_review.id),
                    target_id=str(target_id),
                )
                skipped_review_ids.add(src_review.id)
                continue
            existing_target_week_starts.add(src_review.week_start)
            new_id = uuid.uuid4()
            review_id_map[src_review.id] = new_id
            db.add(WeeklyReview(
                id=new_id,
                user_id=target_id,
                week_start=src_review.week_start,
                week_end=src_review.week_end,
                name=src_review.name,
                notes=src_review.notes,
            ))
            rows.weekly_reviews += 1

        # ────────────────────────────────────────────────────────────────────
        # Step 9: portfolio_positions_db  (self-referential parent_id)
        #
        # Phase A — insert all rows with parent_id=None.
        # Phase B — flush to get DB-assigned timestamps, then UPDATE parent_id.
        # ────────────────────────────────────────────────────────────────────
        src_positions = (
            await db.execute(
                select(PortfolioDbPosition).where(PortfolioDbPosition.user_id == source_id)
            )
        ).scalars().all()

        position_id_map: dict[uuid.UUID, uuid.UUID] = {}

        # Phase A — insert without parent_id
        for src_pos in src_positions:
            new_id = uuid.uuid4()
            position_id_map[src_pos.id] = new_id
            new_portfolio_id = (
                portfolio_id_map.get(src_pos.portfolio_id)
                if src_pos.portfolio_id is not None
                else None
            )
            db.add(PortfolioDbPosition(
                id=new_id,
                user_id=target_id,
                symbol=src_pos.symbol,
                direction=src_pos.direction,
                entry_date=src_pos.entry_date,
                entry_price=src_pos.entry_price,
                position_size=src_pos.position_size,
                sl=src_pos.sl,
                tp=src_pos.tp,
                status=src_pos.status,
                exit_date=src_pos.exit_date,
                exit_price=src_pos.exit_price,
                remarks=src_pos.remarks,
                portfolio_id=new_portfolio_id,
                parent_id=None,  # set in Phase B
            ))
            rows.portfolio_positions_db += 1

        # Flush so new rows are visible for the Phase B update
        await db.flush()

        # Phase B — update parent_id where the source row had one
        for src_pos in src_positions:
            if src_pos.parent_id is not None:
                new_parent_id = position_id_map.get(src_pos.parent_id)
                if new_parent_id is not None:
                    new_self_id = position_id_map[src_pos.id]
                    # Fetch the just-inserted row and update its parent_id
                    new_pos_obj = (
                        await db.execute(
                            select(PortfolioDbPosition).where(
                                PortfolioDbPosition.id == new_self_id
                            )
                        )
                    ).scalar_one()
                    new_pos_obj.parent_id = new_parent_id

        # ────────────────────────────────────────────────────────────────────
        # Step 10: holdings
        # ────────────────────────────────────────────────────────────────────
        src_holdings = (
            await db.execute(
                select(Holding).join(Portfolio, Holding.portfolio_id == Portfolio.id).where(
                    Portfolio.user_id == source_id
                )
            )
        ).scalars().all()

        for src_h in src_holdings:
            new_portfolio_id = portfolio_id_map.get(src_h.portfolio_id)
            if new_portfolio_id is None:
                continue  # orphaned — should not occur given Step 1 built the full map
            db.add(Holding(
                id=uuid.uuid4(),
                portfolio_id=new_portfolio_id,
                symbol=src_h.symbol,
                name=src_h.name,
                quantity=src_h.quantity,
                avg_cost=src_h.avg_cost,
                sector=src_h.sector,
                asset_class=src_h.asset_class,
            ))
            rows.holdings += 1

        # ────────────────────────────────────────────────────────────────────
        # Step 11: investment_transactions  (has BOTH portfolio_id AND user_id)
        # ────────────────────────────────────────────────────────────────────
        src_txns = (
            await db.execute(
                select(InvestmentTransaction).where(InvestmentTransaction.user_id == source_id)
            )
        ).scalars().all()

        for src_txn in src_txns:
            new_portfolio_id = portfolio_id_map.get(src_txn.portfolio_id)
            if new_portfolio_id is None:
                continue
            db.add(InvestmentTransaction(
                id=uuid.uuid4(),
                portfolio_id=new_portfolio_id,
                user_id=target_id,
                date=src_txn.date,
                action=src_txn.action,
                amount=src_txn.amount,
                currency=src_txn.currency,
                note=src_txn.note,
            ))
            rows.investment_transactions += 1

        # ────────────────────────────────────────────────────────────────────
        # Step 12: purchase_plan_items
        # ────────────────────────────────────────────────────────────────────
        src_purchase_items = (
            await db.execute(
                select(PurchasePlanItem)
                .join(ActionPlan, PurchasePlanItem.plan_id == ActionPlan.id)
                .where(ActionPlan.created_by == source_id)
            )
        ).scalars().all()

        for src_pi in src_purchase_items:
            new_plan_id = plan_id_map.get(src_pi.plan_id)
            if new_plan_id is None:
                continue
            db.add(PurchasePlanItem(
                id=uuid.uuid4(),
                plan_id=new_plan_id,
                sort_order=src_pi.sort_order,
                stock=src_pi.stock,
                current_price=src_pi.current_price,
                size=src_pi.size,
                buy_price=src_pi.buy_price,
                tp=src_pi.tp,
                sl=src_pi.sl,
                strategy=src_pi.strategy,
                reason=src_pi.reason,
                triggered=src_pi.triggered,
            ))
            rows.purchase_plan_items += 1

        # ────────────────────────────────────────────────────────────────────
        # Step 13: portfolio_plan_items
        # ────────────────────────────────────────────────────────────────────
        src_portfolio_items = (
            await db.execute(
                select(PortfolioPlanItem)
                .join(ActionPlan, PortfolioPlanItem.plan_id == ActionPlan.id)
                .where(ActionPlan.created_by == source_id)
            )
        ).scalars().all()

        for src_ppi in src_portfolio_items:
            new_plan_id = plan_id_map.get(src_ppi.plan_id)
            if new_plan_id is None:
                continue
            db.add(PortfolioPlanItem(
                id=uuid.uuid4(),
                plan_id=new_plan_id,
                sort_order=src_ppi.sort_order,
                symbol=src_ppi.symbol,
                current_price=src_ppi.current_price,
                size=src_ppi.size,
                entry_price=src_ppi.entry_price,
                tp=src_ppi.tp,
                sl=src_ppi.sl,
                order_size=src_ppi.order_size,
            ))
            rows.portfolio_plan_items += 1

        # ────────────────────────────────────────────────────────────────────
        # Step 14: weekly_scan_items
        # ────────────────────────────────────────────────────────────────────
        src_scan_items = (
            await db.execute(
                select(WeeklyScanItem)
                .join(WeeklyScan, WeeklyScanItem.scan_id == WeeklyScan.id)
                .where(WeeklyScan.user_id == source_id)
            )
        ).scalars().all()

        for src_si in src_scan_items:
            new_scan_id = scan_id_map.get(src_si.scan_id)
            if new_scan_id is None:
                continue
            db.add(WeeklyScanItem(
                id=uuid.uuid4(),
                scan_id=new_scan_id,
                symbol=src_si.symbol,
                sort_order=src_si.sort_order,
                list_name=src_si.list_name,
                market=src_si.market,
                color_mark=src_si.color_mark,
                strategy=src_si.strategy,
                buy_price=src_si.buy_price,
                size=src_si.size,
                tp=src_si.tp,
                sl=src_si.sl,
                remark=src_si.remark,
            ))
            rows.weekly_scan_items += 1

        # ────────────────────────────────────────────────────────────────────
        # Step 15: weekly_review_items
        # Skip items whose parent review was skipped.
        # Remap source_position_id via position_id_map; set NULL if unmapped.
        # ────────────────────────────────────────────────────────────────────
        src_review_items = (
            await db.execute(
                select(WeeklyReviewItem)
                .join(WeeklyReview, WeeklyReviewItem.review_id == WeeklyReview.id)
                .where(WeeklyReview.user_id == source_id)
            )
        ).scalars().all()

        for src_ri in src_review_items:
            if src_ri.review_id in skipped_review_ids:
                _log.debug(
                    "clone.weekly_review_item.skipped_parent_skipped",
                    source_item_id=str(src_ri.id),
                    source_review_id=str(src_ri.review_id),
                )
                continue

            new_review_id = review_id_map.get(src_ri.review_id)
            if new_review_id is None:
                continue

            new_source_position_id: uuid.UUID | None = None
            if src_ri.source_position_id is not None:
                new_source_position_id = position_id_map.get(src_ri.source_position_id)
                if new_source_position_id is None:
                    _log.debug(
                        "clone.weekly_review_item.position_id_unmapped",
                        source_item_id=str(src_ri.id),
                        source_position_id=str(src_ri.source_position_id),
                    )

            db.add(WeeklyReviewItem(
                id=uuid.uuid4(),
                review_id=new_review_id,
                symbol=src_ri.symbol,
                item_type=src_ri.item_type,
                buy_date=src_ri.buy_date,
                buy_price=src_ri.buy_price,
                buy_size=src_ri.buy_size,
                sell_date=src_ri.sell_date,
                sell_price=src_ri.sell_price,
                sell_size=src_ri.sell_size,
                buy_reason=src_ri.buy_reason,
                buy_feeling=src_ri.buy_feeling,
                sell_reason=src_ri.sell_reason,
                sell_feeling=src_ri.sell_feeling,
                week_open_price=src_ri.week_open_price,
                week_close_price=src_ri.week_close_price,
                source_position_id=new_source_position_id,
                sort_order=src_ri.sort_order,
            ))
            rows.weekly_review_items += 1

    # Transaction committed — build response
    total = sum(rows.model_dump().values())

    _log.info(
        "clone.completed",
        admin_id=str(admin.id),
        admin_name=admin.name,
        source_id=str(source.id),
        source_name=source.name,
        target_id=str(target.id),
        target_name=target.name,
        portfolio_mode=portfolio_mode,
        rows_cloned=rows.model_dump(),
        total_rows=total,
    )

    return CloneExecuteResponse(
        cloned_by_admin_id=str(admin.id),
        cloned_by_admin_name=admin.name,
        source_user_id=str(source.id),
        source_user_name=source.name,
        target_user_id=str(target.id),
        target_user_name=target.name,
        portfolio_mode_applied=portfolio_mode,
        cloned_at=datetime.now(timezone.utc),
        rows_cloned=rows,
        total_rows_cloned=total,
    )
