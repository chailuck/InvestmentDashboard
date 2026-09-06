"""Code-owned capability registry for configurable tracking-item types
(ADR-027).

*Labels are data; capabilities are code.* This module IS the fixed set. A
user can never invent a capability, and system types' capabilities are
locked. There is deliberately NO database CHECK on
``ft_item_type_capability.capability_key`` — validation lives here so adding
a real capability in a future release is a code-only change.

v1 capability set is EXACTLY these two (OQ-12). No latent extras.
"""

from __future__ import annotations

from enum import Enum


class Capability(str, Enum):
    """The complete, fixed capability set. String-valued so a member compares
    equal to its wire/DB key (``Capability.BOND_REGISTER == "bond_register"``)."""

    COUNTS_AS_PROPERTY = "counts_as_property"
    """Item is counted in ``propertyBreakdown.propertyTotal`` (server) and the
    Analysis Property lens (client). Pure aggregation predicate — nothing
    structural sits behind it, so it is admin-assignable to custom types."""

    BOND_REGISTER = "bond_register"
    """Unlocks the ``ft_bond`` CRUD register + the bond routes + the
    ``<BondsSection>`` screen. Needs a table, 5 endpoints and a UI section
    that only engineering delivers — system-only, never grantable via the
    API (not even onto a system type that lacks it)."""


# May be toggled on ANY non-system type through PUT /item-types/{id}.
ADMIN_ASSIGNABLE: frozenset[Capability] = frozenset({Capability.COUNTS_AS_PROPERTY})

# Code-bound; the API rejects any attempt to set these on any type.
SYSTEM_ONLY: frozenset[Capability] = frozenset({Capability.BOND_REGISTER})

# Every known key, as plain strings.
ALL_CAPABILITY_KEYS: frozenset[str] = frozenset(c.value for c in Capability)


class CapabilityValidationError(ValueError):
    """Raised by :func:`validate_requested_capabilities` when a requested key
    is unknown or not admin-assignable. The router maps this to a 422."""


def validate_requested_capabilities(keys: list[str]) -> list[str]:
    """Validate a client-supplied capability list for a create/update.

    Rules (see §E.2 / §E.3):
      - every key must be a known :class:`Capability` value  -> else 422
      - every key must be in :data:`ADMIN_ASSIGNABLE`        -> else 422
        (this is what rejects ``bond_register`` and unknown keys for every row)

    Returns the de-duplicated, sorted list on success.
    """
    seen: set[str] = set()
    for key in keys:
        if key not in ALL_CAPABILITY_KEYS:
            raise CapabilityValidationError(
                f"Unknown capability {key!r}. Known capabilities: "
                f"{sorted(ALL_CAPABILITY_KEYS)}"
            )
        if key not in {c.value for c in ADMIN_ASSIGNABLE}:
            raise CapabilityValidationError(
                f"Capability {key!r} is not admin-assignable; it is provided "
                "only by a built-in system type and cannot be added to any type."
            )
        seen.add(key)
    return sorted(seen)
