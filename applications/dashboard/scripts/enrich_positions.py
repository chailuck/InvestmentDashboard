#!/usr/bin/env python3
"""
enrich_positions.py — Backfill portfolio_positions_db from weekly_review_items.

Reads buy_reason, buy_feeling, sell_reason, sell_feeling from weekly_review_items
and patches the four corresponding columns (reason, feel, sell_reason, sell_feel)
in portfolio_positions_db — but ONLY into NULL / empty-string fields (safety rule).

Match strategy (in priority order):
  Path A — Direct FK: weekly_review_items.source_position_id → portfolio_positions_db.id
  Path B — Symbol + buy_date: (user_id, symbol, entry_date = buy_date), single match only
  Path C — Symbol + sell_date: (user_id, symbol, exit_date = sell_date), single match only
             used when buy_date IS NULL but sell_date IS NOT NULL

Usage:
  python enrich_positions.py --user-id <UUID> [--dry-run] [--execute] [--db-url postgresql://...]

Flags:
  --dry-run   (default) Show what would be updated without writing anything.
  --execute   Write changes to the database inside a single transaction.
  --db-url    Connection string. Default: postgresql://postgres:postgres@localhost:5432/investment_db

Author: Claude Code / Backend Engineer
"""

import argparse
import sys
from dataclasses import dataclass, field
from typing import Optional
from uuid import UUID

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("ERROR: psycopg2 is not installed. Install it with: pip install psycopg2-binary")
    sys.exit(1)

# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class ReviewItem:
    id: str
    review_id: str
    symbol: str
    item_type: str
    buy_date: Optional[object]
    sell_date: Optional[object]
    buy_reason: Optional[str]
    buy_feeling: Optional[int]
    sell_reason: Optional[str]
    sell_feeling: Optional[int]
    source_position_id: Optional[str]


@dataclass
class PositionPatch:
    position_id: str
    symbol: str
    match_path: str        # PATH_A | PATH_B | PATH_C
    confidence: str        # HIGH_CONFIDENCE | AMBIGUOUS
    # fields to write (None = source was null, don't touch)
    reason: Optional[str]
    feel: Optional[int]
    sell_reason: Optional[str]
    sell_feel: Optional[int]
    # current values in DB
    current_reason: Optional[str]
    current_feel: Optional[int]
    current_sell_reason: Optional[str]
    current_sell_feel: Optional[int]


@dataclass
class Summary:
    positions_updated: int = 0
    fields_written: int = 0
    reason_written: int = 0
    feel_written: int = 0
    sell_reason_written: int = 0
    sell_feel_written: int = 0
    skipped_filled: int = 0
    skipped_ambiguous: int = 0
    skipped_no_date: int = 0
    ambiguous_symbols: list = field(default_factory=list)
    no_date_items: list = field(default_factory=list)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def is_empty(value) -> bool:
    """Return True if value is NULL or empty string."""
    if value is None:
        return True
    if isinstance(value, str) and value.strip() == "":
        return True
    return False


def display_value(v) -> str:
    if v is None:
        return "NULL"
    return repr(v)


# ---------------------------------------------------------------------------
# Core logic
# ---------------------------------------------------------------------------

def load_review_items(cur, user_id: str) -> list[ReviewItem]:
    cur.execute("""
        SELECT r.id, r.review_id, r.symbol, r.item_type,
               r.buy_date, r.sell_date,
               r.buy_reason, r.buy_feeling, r.sell_reason, r.sell_feeling,
               r.source_position_id
        FROM weekly_review_items r
        JOIN weekly_reviews wr ON wr.id = r.review_id
        WHERE wr.user_id = %s
        ORDER BY r.symbol, r.buy_date NULLS LAST
    """, (user_id,))
    rows = cur.fetchall()
    return [ReviewItem(*row) for row in rows]


def load_position(cur, position_id: str, user_id: str) -> Optional[dict]:
    cur.execute("""
        SELECT id, symbol, entry_date, exit_date,
               reason, feel, sell_reason, sell_feel
        FROM portfolio_positions_db
        WHERE id = %s AND user_id = %s
    """, (position_id, user_id))
    row = cur.fetchone()
    if row is None:
        return None
    cols = ["id", "symbol", "entry_date", "exit_date", "reason", "feel", "sell_reason", "sell_feel"]
    return dict(zip(cols, row))


def find_positions_by_symbol_buy_date(cur, user_id: str, symbol: str, buy_date) -> list[dict]:
    cur.execute("""
        SELECT id, symbol, entry_date, exit_date,
               reason, feel, sell_reason, sell_feel
        FROM portfolio_positions_db
        WHERE user_id = %s AND symbol = %s AND entry_date = %s
        ORDER BY id
    """, (user_id, symbol, buy_date))
    rows = cur.fetchall()
    cols = ["id", "symbol", "entry_date", "exit_date", "reason", "feel", "sell_reason", "sell_feel"]
    return [dict(zip(cols, r)) for r in rows]


def find_positions_by_symbol_sell_date(cur, user_id: str, symbol: str, sell_date) -> list[dict]:
    cur.execute("""
        SELECT id, symbol, entry_date, exit_date,
               reason, feel, sell_reason, sell_feel
        FROM portfolio_positions_db
        WHERE user_id = %s AND symbol = %s AND exit_date = %s
        ORDER BY id
    """, (user_id, symbol, sell_date))
    rows = cur.fetchall()
    cols = ["id", "symbol", "entry_date", "exit_date", "reason", "feel", "sell_reason", "sell_feel"]
    return [dict(zip(cols, r)) for r in rows]


def has_any_annotation(item: ReviewItem) -> bool:
    return (
        not is_empty(item.buy_reason)
        or item.buy_feeling is not None
        or not is_empty(item.sell_reason)
        or item.sell_feeling is not None
    )


def build_patch(item: ReviewItem, pos: dict, path: str) -> PositionPatch:
    return PositionPatch(
        position_id=pos["id"],
        symbol=pos["symbol"],
        match_path=path,
        confidence="HIGH_CONFIDENCE",
        reason=item.buy_reason if not is_empty(item.buy_reason) else None,
        feel=item.buy_feeling,
        sell_reason=item.sell_reason if not is_empty(item.sell_reason) else None,
        sell_feel=item.sell_feeling,
        current_reason=pos["reason"],
        current_feel=pos["feel"],
        current_sell_reason=pos["sell_reason"],
        current_sell_feel=pos["sell_feel"],
    )


def print_patch_detail(patch: PositionPatch, dry_run: bool) -> tuple[int, int, int, int, int]:
    """
    Print the per-row output. Returns (any_written, reason_w, feel_w, sell_reason_w, sell_feel_w).
    """
    label = "DRY_RUN" if dry_run else "UPDATED"

    field_lines = []
    reason_w = feel_w = sell_reason_w = sell_feel_w = 0
    any_skip_fill = False

    # reason
    if patch.reason is not None:
        if is_empty(patch.current_reason):
            field_lines.append(f"           reason:       NULL → {display_value(patch.reason)}")
            reason_w = 1
        else:
            field_lines.append(
                f"           reason:       (skip — already = {display_value(patch.current_reason)}, "
                f"source = {display_value(patch.reason)}, not overwriting)"
            )
            any_skip_fill = True
    else:
        field_lines.append("           reason:       (skip — source is NULL)")

    # feel
    if patch.feel is not None:
        if patch.current_feel is None:
            field_lines.append(f"           feel:         NULL → {patch.feel}")
            feel_w = 1
        else:
            field_lines.append(
                f"           feel:         (skip — already = {patch.current_feel}, "
                f"source = {patch.feel}, not overwriting)"
            )
            any_skip_fill = True
    else:
        field_lines.append("           feel:         (skip — source is NULL)")

    # sell_reason
    if patch.sell_reason is not None:
        if is_empty(patch.current_sell_reason):
            field_lines.append(f"           sell_reason:  NULL → {display_value(patch.sell_reason)}")
            sell_reason_w = 1
        else:
            field_lines.append(
                f"           sell_reason:  (skip — already = {display_value(patch.current_sell_reason)}, "
                f"source = {display_value(patch.sell_reason)}, not overwriting)"
            )
            any_skip_fill = True
    else:
        field_lines.append("           sell_reason:  (skip — source is NULL)")

    # sell_feel
    if patch.sell_feel is not None:
        if patch.current_sell_feel is None:
            field_lines.append(f"           sell_feel:    NULL → {patch.sell_feel}")
            sell_feel_w = 1
        else:
            field_lines.append(
                f"           sell_feel:    (skip — already = {patch.current_sell_feel}, "
                f"source = {patch.sell_feel}, not overwriting)"
            )
            any_skip_fill = True
    else:
        field_lines.append("           sell_feel:    (skip — source is NULL)")

    total_w = reason_w + feel_w + sell_reason_w + sell_feel_w

    if total_w > 0:
        print(f"\n[{label}]  pos_id={patch.position_id}  symbol={patch.symbol}  match={patch.confidence}  path={patch.match_path}")
        for line in field_lines:
            print(line)
    elif any_skip_fill:
        print(f"\n[SKIPPED_FILLED]  pos_id={patch.position_id}  symbol={patch.symbol}")
        for line in field_lines:
            print(line)

    return total_w, reason_w, feel_w, sell_reason_w, sell_feel_w


def apply_patch(cur, patch: PositionPatch) -> tuple[int, int, int, int]:
    """
    Write only NULL/empty fields. Returns (reason_w, feel_w, sell_reason_w, sell_feel_w).
    """
    updates = {}
    reason_w = feel_w = sell_reason_w = sell_feel_w = 0

    if patch.reason is not None and is_empty(patch.current_reason):
        updates["reason"] = patch.reason
        reason_w = 1
    if patch.feel is not None and patch.current_feel is None:
        updates["feel"] = patch.feel
        feel_w = 1
    if patch.sell_reason is not None and is_empty(patch.current_sell_reason):
        updates["sell_reason"] = patch.sell_reason
        sell_reason_w = 1
    if patch.sell_feel is not None and patch.current_sell_feel is None:
        updates["sell_feel"] = patch.sell_feel
        sell_feel_w = 1

    if updates:
        set_clause = ", ".join(f"{col} = %s" for col in updates)
        values = list(updates.values()) + [patch.position_id]
        cur.execute(
            f"UPDATE portfolio_positions_db SET {set_clause}, updated_at = NOW() WHERE id = %s",
            values
        )

    return reason_w, feel_w, sell_reason_w, sell_feel_w


def process(cur, user_id: str, dry_run: bool) -> Summary:
    summary = Summary()
    items = load_review_items(cur, user_id)

    # Track which position IDs we have already scheduled an update for (avoid double-patching
    # the same position from two different review items in the same run).
    visited_positions: set[str] = set()

    for item in items:
        # --- HOLD items with no dates → always SKIPPED_NO_DATE ---
        if item.item_type == "HOLD" and item.buy_date is None and item.sell_date is None:
            print(
                f"\n[SKIPPED_NO_DATE]  symbol={item.symbol}  item_type=HOLD  "
                f"review_id={item.review_id}"
            )
            summary.skipped_no_date += 1
            summary.no_date_items.append(item.symbol)
            continue

        # Skip items with no annotations at all — nothing to enrich
        if not has_any_annotation(item):
            continue

        pos = None
        match_path = None

        # ── PATH A: direct FK ────────────────────────────────────────────────
        if item.source_position_id:
            pos = load_position(cur, item.source_position_id, user_id)
            if pos:
                match_path = "PATH_A"
            # if FK points to a position of a different user or is dangling, skip
            if pos is None:
                print(
                    f"\n[SKIPPED_BROKEN_FK]  symbol={item.symbol}  "
                    f"source_position_id={item.source_position_id}  (not found for this user)"
                )
                continue

        # ── PATH B: symbol + buy_date ─────────────────────────────────────────
        if pos is None and item.buy_date is not None:
            candidates = find_positions_by_symbol_buy_date(cur, user_id, item.symbol, item.buy_date)
            if len(candidates) == 1:
                pos = candidates[0]
                match_path = "PATH_B"
            elif len(candidates) > 1:
                ids_str = ", ".join(c["id"] for c in candidates)
                print(
                    f"\n[SKIPPED_AMBIGUOUS]  symbol={item.symbol}  buy_date={item.buy_date}  "
                    f"match=PATH_B"
                )
                print(f"           {len(candidates)} candidate positions: {ids_str}")
                summary.skipped_ambiguous += 1
                summary.ambiguous_symbols.append(f"{item.symbol}/{item.buy_date}")
                continue
            # len == 0: no match, fall through to Path C

        # ── PATH C: symbol + sell_date (fallback when buy_date is NULL) ───────
        if pos is None and item.buy_date is None and item.sell_date is not None:
            candidates = find_positions_by_symbol_sell_date(cur, user_id, item.symbol, item.sell_date)
            if len(candidates) == 1:
                pos = candidates[0]
                match_path = "PATH_C"
            elif len(candidates) > 1:
                ids_str = ", ".join(c["id"] for c in candidates)
                print(
                    f"\n[SKIPPED_AMBIGUOUS]  symbol={item.symbol}  sell_date={item.sell_date}  "
                    f"match=PATH_C"
                )
                print(f"           {len(candidates)} candidate positions: {ids_str}")
                summary.skipped_ambiguous += 1
                summary.ambiguous_symbols.append(f"{item.symbol}/sell={item.sell_date}")
                continue

        if pos is None:
            # No match found through any path
            print(
                f"\n[SKIPPED_NO_MATCH]  symbol={item.symbol}  buy_date={item.buy_date}  "
                f"sell_date={item.sell_date}  item_id={item.id}"
            )
            continue

        # Dedup: if we already queued a patch for this position in this run, skip
        if pos["id"] in visited_positions:
            print(
                f"\n[SKIPPED_DUPLICATE]  pos_id={pos['id']}  symbol={pos['symbol']}  "
                f"(already patched by another review item in this run)"
            )
            continue
        visited_positions.add(pos["id"])

        patch = build_patch(item, pos, match_path)

        # Print dry-run/updated detail
        total_w, reason_w, feel_w, sell_reason_w, sell_feel_w = print_patch_detail(patch, dry_run)

        if not dry_run and total_w > 0:
            r_w, f_w, sr_w, sf_w = apply_patch(cur, patch)
            summary.positions_updated += 1
            summary.fields_written += r_w + f_w + sr_w + sf_w
            summary.reason_written += r_w
            summary.feel_written += f_w
            summary.sell_reason_written += sr_w
            summary.sell_feel_written += sf_w
        elif dry_run and total_w > 0:
            summary.positions_updated += 1
            summary.fields_written += total_w
            summary.reason_written += reason_w
            summary.feel_written += feel_w
            summary.sell_reason_written += sell_reason_w
            summary.sell_feel_written += sell_feel_w

        if total_w == 0 and (
            not is_empty(patch.current_reason) and patch.reason is not None
            or patch.current_feel is not None and patch.feel is not None
            or not is_empty(patch.current_sell_reason) and patch.sell_reason is not None
            or patch.current_sell_feel is not None and patch.sell_feel is not None
        ):
            summary.skipped_filled += 1

    return summary


def print_summary(summary: Summary, dry_run: bool) -> None:
    mode = "DRY RUN (no changes written)" if dry_run else "EXECUTED (changes committed)"
    print("\n── Enrichment Summary ──────────────────────")
    print(f"Positions updated:        {summary.positions_updated}")
    print(
        f"Fields written:           {summary.fields_written}  "
        f"(reason: {summary.reason_written}, feel: {summary.feel_written}, "
        f"sell_reason: {summary.sell_reason_written}, sell_feel: {summary.sell_feel_written})"
    )
    print(f"Skipped — already filled: {summary.skipped_filled}")
    print(
        f"Skipped — ambiguous:      {summary.skipped_ambiguous}  "
        f"(manual resolution required)"
        + (f" — {', '.join(summary.ambiguous_symbols)}" if summary.ambiguous_symbols else "")
    )
    print(
        f"Skipped — no date / HOLD: {summary.skipped_no_date}  "
        f"(manual resolution required)"
        + (f" — {', '.join(summary.no_date_items)}" if summary.no_date_items else "")
    )
    print(f"Mode: {mode}")
    print("────────────────────────────────────────────")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Enrich portfolio_positions_db from weekly_review_items annotations."
    )
    parser.add_argument("--user-id", required=True, help="Target user UUID")
    parser.add_argument(
        "--dry-run", action="store_true", default=False,
        help="Show what would be changed without writing (default behaviour)"
    )
    parser.add_argument(
        "--execute", action="store_true", default=False,
        help="Write changes to the database (requires explicit flag)"
    )
    parser.add_argument(
        "--db-url",
        default="postgresql://postgres:postgres@localhost:5432/investment_db",
        help="PostgreSQL connection URL"
    )
    args = parser.parse_args()

    # Validate UUID
    try:
        UUID(args.user_id)
    except ValueError:
        print(f"ERROR: --user-id '{args.user_id}' is not a valid UUID.")
        sys.exit(1)

    # Safety: if neither flag given, default to dry-run
    execute = args.execute and not args.dry_run
    dry_run = not execute

    if dry_run:
        print("Mode: DRY RUN — no changes will be written to the database.")
    else:
        print("Mode: EXECUTE — changes will be committed inside a single transaction.")

    print(f"Target user: {args.user_id}\n")

    conn = psycopg2.connect(args.db_url)
    try:
        with conn:
            with conn.cursor() as cur:
                summary = process(cur, args.user_id, dry_run)
                if dry_run:
                    conn.rollback()
                # if execute: the `with conn:` context manager commits on exit
    except Exception as exc:
        print(f"\nERROR: {exc}")
        print("All changes rolled back.")
        conn.rollback()
        sys.exit(1)
    finally:
        conn.close()

    print_summary(summary, dry_run)


if __name__ == "__main__":
    main()
