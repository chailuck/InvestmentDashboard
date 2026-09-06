"""Unit tests for `ItemTypeRegistry` (ADR-027) against a real session — the
in-memory resolver the balance grid / bond gate / item routers read from."""

from __future__ import annotations

import uuid

import pytest

from app.models.item_type import SYSTEM_ITEM_TYPE_IDS
from app.services.item_type_capabilities import Capability
from app.services.item_type_registry import ItemTypeRegistry

pytestmark = pytest.mark.asyncio


async def test_registry_resolves_seeded_types_and_capabilities(db_session):
    reg = await ItemTypeRegistry.create(db_session)

    prop = reg.by_slug["property"]
    assert str(prop.id) == SYSTEM_ITEM_TYPE_IDS["Property"]
    assert prop.label == "Property"
    assert prop.is_system is True
    assert prop.is_archived is False
    assert prop.has_capability(Capability.COUNTS_AS_PROPERTY.value) is True
    assert prop.has_capability(Capability.BOND_REGISTER.value) is False

    bond = reg.by_slug["bond"]
    assert bond.has_capability(Capability.BOND_REGISTER.value) is True

    bank = reg.by_slug["bank_account"]
    assert bank.capabilities == frozenset()

    # by_id lookup + require()
    assert reg.get(prop.id) is prop
    assert reg.require(prop.id) is prop
    assert reg.get(None) is None
    assert reg.get(uuid.uuid4()) is None
    with pytest.raises(KeyError):
        reg.require(uuid.uuid4())


async def test_registry_ordering_and_active_helpers(db_session):
    reg = await ItemTypeRegistry.create(db_session)

    all_slugs = [r.slug for r in reg.all_ordered()]
    assert all_slugs[:7] == [
        "bank_account", "property", "investment_account", "tax_saving",
        "materials", "insurance", "bond",
    ]
    # active_ordered is a subset of all_ordered with archived removed
    active = reg.active_ordered()
    assert all(not r.is_archived for r in active)
    assert reg.active_count() == len(active)
    assert len(active) >= 7
