"""Portfolio tracker endpoints -- routes to Excel or DB based on user's portfolio_mode."""


from datetime import date, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user_id
from app.database.session import get_db

router = APIRouter(prefix="/portfolio-tracker", tags=["Portfolio Tracker"])

UserId = Annotated[str, Depends(get_current_user_id)]
DB = Annotated[AsyncSession, Depends(get_db)]


def _svc_error(exc: Exception) -> HTTPException:
    if isinstance(exc, FileNotFoundError):
        return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    return HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))


async def _mode(user_id: str, db: AsyncSession) -> str:
    from app.api.v1.endpoints.portfolio_db import get_user_portfolio_mode
    return await get_user_portfolio_mode(user_id, db)


# ""- Refresh """""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""-

@router.post("/refresh")
async def refresh_portfolio(user_id: UserId, db: DB) -> dict[str, Any]:
    if await _mode(user_id, db) == "db":
        return {"status": "ok", "message": "Database mode -- no file to refresh. Data is managed directly in the database."}
    from app.services.portfolio_excel import copy_excel_from_source, _source_path, _working_path
    src = _source_path()
    dst = _working_path()
    if not src.exists():
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail=f"Source file not found: {src}")
    src_size_kb = round(src.stat().st_size / 1024, 1)
    try:
        copy_excel_from_source()
        dst_size_kb = round(dst.stat().st_size / 1024, 1) if dst.exists() else 0
        from app.api.v1.endpoints.portfolio_db import sync_excel_positions_to_db
        sync_result = await sync_excel_positions_to_db(user_id, db)
        return {
            "status": "ok",
            "source": str(src),
            "destination": str(dst),
            "source_size_kb": src_size_kb,
            "destination_size_kb": dst_size_kb,
            "synced_rows": sync_result["synced_rows"],
            "message": f"File copied, cache cleared, and {sync_result['synced_rows']} rows synced to database.",
        }
    except Exception as exc:
        raise _svc_error(exc)


# ""- Raw data """"""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""-

@router.get("/raw-data")
async def get_raw_data(user_id: UserId, db: DB) -> dict[str, Any]:
    if await _mode(user_id, db) == "db":
        from app.api.v1.endpoints.portfolio_db import list_positions_db
        data = await list_positions_db(user_id, db, None, None, "all")
        positions = data["positions"]
        if not positions:
            return {"file": "database", "columns": [], "rows": [], "total": 0}
        columns = list(positions[0].keys())
        rows = [[p[c] for c in columns] for p in positions]
        return {"file": "database", "columns": columns, "rows": rows, "total": len(rows)}
    import pandas as pd
    from app.services.portfolio_excel import _ensure_working_copy, _working_path
    try:
        path = _ensure_working_copy()
        df = pd.read_excel(str(path), sheet_name="Sheet1")
        df = df.where(pd.notna(df), None)
        for col in df.select_dtypes(include=["datetime64[ns]", "datetimetz"]).columns:
            df[col] = df[col].astype(str).where(df[col].notna(), None)
        return {"file": str(_working_path()), "columns": list(df.columns),
                "rows": df.values.tolist(), "total": len(df)}
    except Exception as exc:
        raise _svc_error(exc)


@router.get("/raw-source-data")
async def get_raw_source_data(user_id: UserId, db: DB) -> dict[str, Any]:
    import pandas as pd
    from app.services.portfolio_excel import _source_path
    src = _source_path()
    if not src.exists():
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail=f"Source file not found: {src}")
    try:
        df = pd.read_excel(str(src), sheet_name="Sheet1")
        df = df.where(pd.notna(df), None)
        for col in df.select_dtypes(include=["datetime64[ns]", "datetimetz"]).columns:
            df[col] = df[col].astype(str).where(df[col].notna(), None)
        return {"file": str(src), "columns": list(df.columns),
                "rows": df.values.tolist(), "total": len(df)}
    except Exception as exc:
        raise _svc_error(exc)


# ---- Summary ----------------------------------------------------------------------------------------------------------------------------------------------

@router.get("/summary")
async def get_summary(
    user_id: UserId,
    db: DB,
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
) -> dict[str, Any]:
    today = date.today()
    to_d = to_date or today
    from_d = from_date or (today - timedelta(days=30))

    _empty = {"accumulated_pnl": 0, "win_rate": 0.0, "avg_pnl": 0.0,
              "avg_pnl_pct": 0.0, "total_trades": 0, "wins": 0, "losses": 0}

    if await _mode(user_id, db) == "db":
        from app.api.v1.endpoints.portfolio_db import _get_closed_positions, _pos_net_pnl
        rows = await _get_closed_positions(user_id, db, from_d, to_d)
        if not rows:
            return _empty
        nets = [_pos_net_pnl(r) for r in rows]
        wins = sum(1 for n in nets if n > 0)
        accumulated = sum(nets)
        total = len(nets)
        pct_list = []
        for r in rows:
            if r.entry_price and float(r.entry_price) != 0 and r.exit_price:
                ep, xp = float(r.entry_price), float(r.exit_price)
                mult = -1 if r.direction.upper() == "SHORT" else 1
                pct_list.append((xp - ep) / ep * 100 * mult)
        return {
            "accumulated_pnl": round(accumulated, 0),
            "win_rate": round(wins / total * 100, 1),
            "avg_pnl": round(accumulated / total, 0),
            "avg_pnl_pct": round(sum(pct_list) / len(pct_list), 2) if pct_list else 0.0,
            "total_trades": total, "wins": wins, "losses": total - wins,
        }

    import pandas as pd
    from app.services.portfolio_excel import _load_df
    df = _load_df()
    closed = df[df["Exit Price"].notna()].copy()
    records: list[dict] = []
    for _, r in closed.iterrows():
        edate = r["Exit Date"].date() if pd.notna(r["Exit Date"]) else today
        if edate < from_d or edate > to_d:
            continue
        entry = float(r["Entry Price"]) if pd.notna(r["Entry Price"]) else 0.0
        exit_p = float(r["Exit Price"]) if pd.notna(r["Exit Price"]) else entry
        size = float(r["Position Size"]) if pd.notna(r["Position Size"]) else 0.0
        direction = str(r.get("Position (Long/Short)", "Long"))
        mult = -1 if "short" in direction.lower() else 1
        net = round((exit_p - entry) * size * mult, 0)
        pct = round((exit_p - entry) / entry * 100 * mult, 2) if entry != 0 else 0.0
        records.append({"net": net, "pct": pct})

    total = len(records)
    if not records:
        return _empty
    wins = sum(1 for r in records if r["net"] > 0)
    accumulated = sum(r["net"] for r in records)
    return {
        "accumulated_pnl": round(accumulated, 0),
        "win_rate": round(wins / total * 100, 1),
        "avg_pnl": round(accumulated / total, 0),
        "avg_pnl_pct": round(sum(r["pct"] for r in records) / total, 2),
        "total_trades": total, "wins": wins, "losses": total - wins,
    }


# ---- Positions ------------------------------------------------------------------------------------------------------------------------------------------

@router.get("/positions")
async def list_positions(
    user_id: UserId,
    db: DB,
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
    status: str = Query("active"),
) -> dict[str, Any]:
    if await _mode(user_id, db) == "db":
        from app.api.v1.endpoints.portfolio_db import list_positions_db
        return await list_positions_db(user_id, db, from_date, to_date, status)
    from app.services.portfolio_excel import get_positions
    try:
        positions = get_positions(from_date=from_date, to_date=to_date, status=status)
    except Exception as exc:
        raise _svc_error(exc)
    total_pnl = sum(p["netPnl"] for p in positions)
    return {"positions": positions, "total": len(positions), "totalNetPnl": round(total_pnl, 0)}


# ""- Performance chart """""""""""""""""""""""""""""""""""""""""""""""""""""""""-

@router.get("/performance")
async def get_performance(
    user_id: UserId,
    db: DB,
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
    period: str = Query("daily"),
) -> list[dict[str, Any]]:
    if await _mode(user_id, db) == "db":
        from app.api.v1.endpoints.portfolio_db import get_performance_db
        return await get_performance_db(user_id, db, from_date, to_date, period)
    from app.services.portfolio_excel import get_daily_performance
    try:
        return get_daily_performance(from_date=from_date, to_date=to_date, period=period)
    except Exception as exc:
        raise _svc_error(exc)


# ""- Performance by date (table) """""""""""""""""""""""""""""""""""""""""""""""-

@router.get("/performance/by-date")
async def get_performance_by_date(
    user_id: UserId,
    db: DB,
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
    period: str = Query("daily"),
) -> list[dict[str, Any]]:
    if await _mode(user_id, db) == "db":
        from app.api.v1.endpoints.portfolio_db import get_performance_by_date_db
        return await get_performance_by_date_db(user_id, db, from_date, to_date, period)
    from app.services.portfolio_excel import get_performance_by_date
    try:
        return get_performance_by_date(from_date=from_date, to_date=to_date, period=period)
    except Exception as exc:
        raise _svc_error(exc)


# ""- Transactions drill-down """""""""""""""""""""""""""""""""""""""""""""""""""-

@router.get("/performance/transactions")
async def get_period_transactions(
    user_id: UserId,
    db: DB,
    period_key: str = Query(...),
    period: str = Query("daily"),
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
) -> list[dict[str, Any]]:
    if await _mode(user_id, db) == "db":
        from app.api.v1.endpoints.portfolio_db import get_period_transactions_db
        return await get_period_transactions_db(user_id, db, period_key, period, from_date, to_date)
    from app.services.portfolio_excel import get_period_transactions
    try:
        return get_period_transactions(period_key=period_key, period=period,
                                       from_date=from_date, to_date=to_date)
    except Exception as exc:
        raise _svc_error(exc)


# ""- Performance by stock """"""""""""""""""""""""""""""""""""""""""""""""""""""-

@router.get("/performance/by-stock")
async def get_performance_by_stock(
    user_id: UserId,
    db: DB,
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
) -> list[dict[str, Any]]:
    if await _mode(user_id, db) == "db":
        from app.api.v1.endpoints.portfolio_db import get_performance_by_stock_db
        return await get_performance_by_stock_db(user_id, db, from_date, to_date)
    from app.services.portfolio_excel import get_performance_by_stock
    try:
        return get_performance_by_stock(from_date=from_date, to_date=to_date)
    except Exception as exc:
        raise _svc_error(exc)


# ""- Market indices (same regardless of mode) """"""""""""""""""""""""""""""""""-

@router.get("/market/set-indices")
async def get_set_indices(_: UserId) -> list[dict[str, Any]]:
    from app.services.portfolio_excel import fetch_set_indices
    try:
        return fetch_set_indices()
    except Exception as exc:
        raise _svc_error(exc)


@router.get("/market/global-indices")
async def get_global_indices(_: UserId) -> list[dict[str, Any]]:
    from app.services.portfolio_excel import fetch_global_indices
    try:
        return fetch_global_indices()
    except Exception as exc:
        raise _svc_error(exc)
