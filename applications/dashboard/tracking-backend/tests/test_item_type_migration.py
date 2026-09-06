"""Alembic migration test for ``c2d3e4f5a6b7`` (item-type config, ADR-027).

Runs the REAL migration chain against a DEDICATED throwaway database
(``investment_migration_test_db``) — NEVER ``investment_db`` /
``investment_test_db``. A hard guard below refuses to run if the URL is not a
``*_migration_test_*`` database.

Alembic's ``env.py`` drives migrations through ``asyncio.run``. Running that
in-process would tear down pytest-asyncio's session event loop and break
every later async test, so each ``alembic`` invocation here runs in a
SUBPROCESS. Fixture data is planted between invocations via a plain
synchronous psycopg2 engine.

Asserts (design §C / §K):
  * upgrade -> 7 ``ft_item_type`` rows, correct slugs / sort_order / caps and
    the exact fixed seed UUIDs
  * every pre-existing item back-filled; ``type_id`` NOT NULL; FK index made
  * the old ``ck_ft_tracking_item_type`` CHECK is gone
  * the ``ft_tracking_item_sync_type`` trigger syncs ``type`` on insert/update
  * safe-window downgrade round-trips exactly (tables dropped, CHECK restored,
    every item keeps its original ``type`` string)
  * the zero-null back-fill guard RAISES on an unmapped legacy label
  * downgrade past the safe window (a custom type exists) RAISES
"""

from __future__ import annotations

import os
import subprocess
import sys
import uuid

import pytest
import sqlalchemy as sa

from app.models.item_type import SYSTEM_ITEM_TYPE_SEED

MIGRATION_TEST_DB = "investment_migration_test_db"
_HOST = os.environ.get("MIGRATION_TEST_DB_HOST", "postgres")
_SYNC_URL = f"postgresql+psycopg2://postgres:postgres@{_HOST}:5432/{MIGRATION_TEST_DB}"
_ASYNC_URL = f"postgresql+asyncpg://postgres:postgres@{_HOST}:5432/{MIGRATION_TEST_DB}"
_APP_DIR = "/app"

PARENT = "b1c2d3e4f5a6"
TARGET = "c2d3e4f5a6b7"

# HARD GUARD — this suite issues DROP TABLE against the target DB.
if "migration_test" not in MIGRATION_TEST_DB:
    raise RuntimeError(
        f"Refusing to run migration tests against {MIGRATION_TEST_DB!r} — the "
        "name must contain 'migration_test'."
    )

_PROP_ID = next(r["id"] for r in SYSTEM_ITEM_TYPE_SEED if r["slug"] == "property")
_BOND_ID = next(r["id"] for r in SYSTEM_ITEM_TYPE_SEED if r["slug"] == "bond")

_ALL_FT_TABLES = (
    "ft_item_type_capability, ft_bond, ft_initial_investment_entry, "
    "ft_update_tracking_list_balance, ft_update_tracking_list, ft_tracking_item, "
    "ft_sub_category, ft_category, ft_tracking_set, ft_item_type, ft_alembic_version"
)


def _alembic(*args: str) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    env["DATABASE_URL"] = _ASYNC_URL
    return subprocess.run(
        [sys.executable, "-m", "alembic", "-c", "alembic.ini", *args],
        cwd=_APP_DIR,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )


def _alembic_ok(*args: str) -> None:
    proc = _alembic(*args)
    assert proc.returncode == 0, f"alembic {args} failed:\nSTDOUT{proc.stdout}\nSTDERR{proc.stderr}"


@pytest.fixture
def migration_engine():
    assert "migration_test" in _SYNC_URL
    eng = sa.create_engine(_SYNC_URL, future=True)
    with eng.begin() as c:
        c.execute(sa.text('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"'))
        c.execute(sa.text(f"DROP TABLE IF EXISTS {_ALL_FT_TABLES} CASCADE"))
        c.execute(sa.text("DROP FUNCTION IF EXISTS ft_tracking_item_sync_type_fn() CASCADE"))
    try:
        yield eng
    finally:
        with eng.begin() as c:
            c.execute(sa.text(f"DROP TABLE IF EXISTS {_ALL_FT_TABLES} CASCADE"))
            c.execute(sa.text("DROP FUNCTION IF EXISTS ft_tracking_item_sync_type_fn() CASCADE"))
        eng.dispose()


def _seed_pre_migration_hierarchy(eng, *, extra_bad_label: str | None = None):
    """One set/category/sub-category + one item per seed label, at the PARENT
    revision (old ``type`` VARCHAR + CHECK, no ``type_id``)."""
    uid = uuid.uuid4()
    set_id, cat_id, sub_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    with eng.begin() as c:
        c.execute(
            sa.text("INSERT INTO ft_tracking_set (id, user_id, name) VALUES (:i, :u, 'S')"),
            {"i": set_id, "u": uid},
        )
        c.execute(
            sa.text(
                "INSERT INTO ft_category (id, user_id, tracking_set_id, name, order_index) "
                "VALUES (:i, :u, :s, 'C', 0)"
            ),
            {"i": cat_id, "u": uid, "s": set_id},
        )
        c.execute(
            sa.text(
                "INSERT INTO ft_sub_category (id, user_id, category_id, name, order_index) "
                "VALUES (:i, :u, :c, 'Sub', 0)"
            ),
            {"i": sub_id, "u": uid, "c": cat_id},
        )
        for n, row in enumerate(SYSTEM_ITEM_TYPE_SEED):
            c.execute(
                sa.text(
                    "INSERT INTO ft_tracking_item "
                    "(id, user_id, sub_category_id, name, type, order_index) "
                    "VALUES (:i, :u, :s, :n, :t, :o)"
                ),
                {"i": uuid.uuid4(), "u": uid, "s": sub_id, "n": row["label"],
                 "t": row["label"], "o": n},
            )
        if extra_bad_label is not None:
            c.execute(sa.text("ALTER TABLE ft_tracking_item DROP CONSTRAINT ck_ft_tracking_item_type"))
            c.execute(
                sa.text(
                    "INSERT INTO ft_tracking_item "
                    "(id, user_id, sub_category_id, name, type, order_index) "
                    "VALUES (:i, :u, :s, 'legacy', :t, 99)"
                ),
                {"i": uuid.uuid4(), "u": uid, "s": sub_id, "t": extra_bad_label},
            )
    return uid, sub_id


def test_upgrade_seeds_backfills_enforces_and_trigger_syncs(migration_engine):
    eng = migration_engine
    _alembic_ok("upgrade", PARENT)
    uid, sub_id = _seed_pre_migration_hierarchy(eng)
    _alembic_ok("upgrade", TARGET)

    with eng.connect() as c:
        rows = c.execute(
            sa.text(
                "SELECT slug, label, sort_order, is_system FROM ft_item_type ORDER BY sort_order"
            )
        ).all()
        assert [r.slug for r in rows] == [s["slug"] for s in SYSTEM_ITEM_TYPE_SEED]
        assert [r.label for r in rows] == [s["label"] for s in SYSTEM_ITEM_TYPE_SEED]
        assert [r.sort_order for r in rows] == list(range(7))
        assert all(r.is_system for r in rows)

        ids = {
            r.slug: str(r.id)
            for r in c.execute(sa.text("SELECT id, slug FROM ft_item_type")).all()
        }
        assert ids["property"] == _PROP_ID
        assert ids["bond"] == _BOND_ID

        caps = set(
            c.execute(
                sa.text(
                    "SELECT it.slug, cap.capability_key FROM ft_item_type_capability cap "
                    "JOIN ft_item_type it ON it.id = cap.item_type_id"
                )
            ).all()
        )
        assert caps == {("property", "counts_as_property"), ("bond", "bond_register")}

        assert c.execute(
            sa.text("SELECT count(*) FROM ft_tracking_item WHERE type_id IS NULL")
        ).scalar_one() == 0
        assert c.execute(
            sa.text(
                "SELECT count(*) FROM ft_tracking_item t "
                "JOIN ft_item_type it ON it.id = t.type_id WHERE it.label <> t.type"
            )
        ).scalar_one() == 0

        assert c.execute(
            sa.text(
                "SELECT is_nullable FROM information_schema.columns "
                "WHERE table_name = 'ft_tracking_item' AND column_name = 'type_id'"
            )
        ).scalar_one() == "NO"

        assert c.execute(
            sa.text("SELECT count(*) FROM pg_indexes WHERE indexname = 'ix_ft_tracking_item_type_id'")
        ).scalar_one() == 1

        assert c.execute(
            sa.text(
                "SELECT count(*) FROM information_schema.table_constraints "
                "WHERE constraint_name = 'ck_ft_tracking_item_type'"
            )
        ).scalar_one() == 0

    # trigger: insert with only type_id -> `type` derived
    new_id = uuid.uuid4()
    with eng.begin() as c:
        c.execute(
            sa.text(
                "INSERT INTO ft_tracking_item "
                "(id, user_id, sub_category_id, name, type_id, order_index) "
                "VALUES (:i, :u, :s, 'trig', :t, 100)"
            ),
            {"i": new_id, "u": uid, "s": sub_id, "t": _PROP_ID},
        )
    with eng.connect() as c:
        assert c.execute(
            sa.text("SELECT type FROM ft_tracking_item WHERE id = :i"), {"i": new_id}
        ).scalar_one() == "Property"

    with eng.begin() as c:
        c.execute(
            sa.text("UPDATE ft_tracking_item SET type_id = :t WHERE id = :i"),
            {"t": _BOND_ID, "i": new_id},
        )
    with eng.connect() as c:
        assert c.execute(
            sa.text("SELECT type FROM ft_tracking_item WHERE id = :i"), {"i": new_id}
        ).scalar_one() == "BOND"

    # ── safe-window downgrade round-trips exactly ────────────────────────
    with eng.begin() as c:
        c.execute(sa.text("DELETE FROM ft_tracking_item WHERE name = 'trig'"))

    _alembic_ok("downgrade", PARENT)

    with eng.connect() as c:
        assert c.execute(sa.text("SELECT to_regclass('ft_item_type')")).scalar() is None
        assert c.execute(sa.text("SELECT to_regclass('ft_item_type_capability')")).scalar() is None
        cols = c.execute(
            sa.text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'ft_tracking_item'"
            )
        ).scalars().all()
        assert "type_id" not in cols
        assert c.execute(
            sa.text(
                "SELECT count(*) FROM information_schema.table_constraints "
                "WHERE constraint_name = 'ck_ft_tracking_item_type'"
            )
        ).scalar_one() == 1
        kept = c.execute(
            sa.text("SELECT DISTINCT type FROM ft_tracking_item ORDER BY type")
        ).scalars().all()
        assert set(kept) == {s["label"] for s in SYSTEM_ITEM_TYPE_SEED}


def test_backfill_guard_raises_on_unmapped_legacy_label(migration_engine):
    eng = migration_engine
    _alembic_ok("upgrade", PARENT)
    _seed_pre_migration_hierarchy(eng, extra_bad_label="Totally Unknown Type")

    proc = _alembic("upgrade", TARGET)
    combined = proc.stdout + proc.stderr
    assert proc.returncode != 0, combined
    assert "Totally Unknown Type" in combined or "could not be" in combined
    # the guard aborted -> the new tables were rolled back
    with eng.connect() as c:
        assert c.execute(sa.text("SELECT to_regclass('ft_item_type')")).scalar() is None


def test_downgrade_refuses_past_safe_window(migration_engine):
    eng = migration_engine
    _alembic_ok("upgrade", PARENT)
    _seed_pre_migration_hierarchy(eng)
    _alembic_ok("upgrade", TARGET)

    with eng.begin() as c:
        c.execute(
            sa.text(
                "INSERT INTO ft_item_type (id, slug, label, sort_order, is_system) "
                "VALUES (:i, 'crypto', 'Crypto', 7, false)"
            ),
            {"i": uuid.uuid4()},
        )

    proc = _alembic("downgrade", PARENT)
    combined = (proc.stdout + proc.stderr).lower()
    assert proc.returncode != 0
    assert "safe window" in combined
    with eng.connect() as c:
        assert c.execute(sa.text("SELECT to_regclass('ft_item_type')")).scalar() is not None
