"""Semantic catalog contract for the hardened Morning operation ledger."""
from __future__ import annotations

import re


TABLE = "morning_document_operations"
EXPECTED_STATES = {
    "reserved",
    "pending",
    "created_unverified",
    "created",
    "needs_reconciliation",
    "failed",
}
UNRESOLVED_STATES = {
    "reserved",
    "pending",
    "created_unverified",
    "needs_reconciliation",
}


def _compact(value: str | None) -> str:
    return re.sub(r"\s+", " ", value or "").strip().lower()


def _quoted_values(value: str | None) -> set[str]:
    return set(re.findall(r"'([^']+)'", value or ""))


def _rows(inventory: dict, section: str) -> list[dict]:
    return [
        row
        for row in (inventory.get(section) or [])
        if row.get("schema") == "public" and row.get("table", row.get("name")) == TABLE
    ]


def assert_morning_schema_contract(inventory: dict) -> None:
    tables = [
        row
        for row in (inventory.get("tables") or [])
        if row.get("schema") == "public" and row.get("name") == TABLE
    ]
    assert len(tables) == 1, f"expected exactly one public.{TABLE}, found {len(tables)}"
    assert tables[0].get("rls") is True, "Morning operation ledger must keep RLS enabled"

    columns = {row["name"]: row for row in _rows(inventory, "columns")}
    for name in ("verified_at", "issuance_started_at"):
        assert name in columns, f"missing hardened Morning column: {name}"
        assert columns[name].get("type") == "timestamp with time zone", (name, columns[name])
        assert columns[name].get("not_null") is False, (name, columns[name])

    constraints = {row["name"]: row for row in _rows(inventory, "constraints")}
    assert "morning_document_operations_owner_id_fkey" not in constraints, (
        "owner FK would erase issuance evidence when an auth user is deleted"
    )

    state = constraints.get("morning_document_operations_state_check")
    assert state, "missing Morning state constraint"
    assert _quoted_values(state.get("definition")) == EXPECTED_STATES, state

    created = _compact(constraints.get("morning_document_operations_created_verified_check", {}).get("definition"))
    assert "state <> 'created'::text" in created, created
    assert "document_id is not null" in created and "verified_at is not null" in created, created

    unverified = _compact(constraints.get("morning_document_operations_created_unverified_document_check", {}).get("definition"))
    assert "state <> 'created_unverified'::text" in unverified, unverified
    assert "document_id is not null" in unverified, unverified

    issuance = _compact(constraints.get("morning_document_operations_issuance_started_check", {}).get("definition"))
    assert {"reserved", "failed"}.issubset(_quoted_values(issuance)), issuance
    assert "issuance_started_at is not null" in issuance, issuance

    indexes = {row["name"]: row for row in _rows(inventory, "indexes")}
    unresolved = _compact(indexes.get("morning_document_operations_unresolved_fingerprint_uidx", {}).get("definition"))
    assert "create unique index" in unresolved, unresolved
    assert "(environment, request_fingerprint)" in unresolved, unresolved
    assert "owner_id" not in unresolved, unresolved
    assert _quoted_values(unresolved) == UNRESOLVED_STATES, unresolved

    document = _compact(indexes.get("morning_document_operations_document_uidx", {}).get("definition"))
    assert "create unique index" in document, document
    assert "(environment, document_id)" in document, document
    assert "document_id is not null" in document, document
