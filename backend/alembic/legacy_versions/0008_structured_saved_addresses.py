"""Store saved customer addresses as structured parts and map coordinates.

Revision ID: 0008_structured_saved_addresses
Revises: 0007_delivery_radius_km
"""
import json

import sqlalchemy as sa
from alembic import op

revision = "0008_structured_saved_addresses"
down_revision = "0007_delivery_radius_km"
branch_labels = None
depends_on = None


def _parts_from_legacy_address(value: str) -> dict[str, str]:
    """Recover fields from the previous comma-separated saved address format."""
    parts = [part.strip() for part in value.split(",") if part.strip()]
    if not parts:
        return {}
    if len(parts) == 5:
        names = ("house_number", "road", "area", "city", "pincode")
        return dict(zip(names, parts))
    if len(parts) >= 6:
        return {
            "house_number": parts[0],
            "road": parts[1],
            "area": parts[2],
            "landmark": ", ".join(parts[3:-2]),
            "city": parts[-2],
            "pincode": parts[-1],
        }
    # Keep a short legacy value visible for correction after the customer pins
    # the location, rather than silently discarding it.
    return {"house_number": value.strip()}


def _normalize_address(value: dict) -> dict:
    legacy = value.get("address")
    recovered = _parts_from_legacy_address(legacy) if isinstance(legacy, str) else {}
    pincode = value.get("pincode") or value.get("postal_code") or recovered.get("pincode", "")

    latitude = value.get("latitude")
    longitude = value.get("longitude")
    try:
        latitude = float(latitude) if latitude is not None else None
        longitude = float(longitude) if longitude is not None else None
    except (TypeError, ValueError):
        latitude = longitude = None
    if latitude is None or longitude is None:
        latitude = longitude = None

    return {
        "id": str(value.get("id") or "home"),
        "label": str(value.get("label") or "Home"),
        "house_number": str(value.get("house_number") or recovered.get("house_number", "")),
        "road": str(value.get("road") or recovered.get("road", "")),
        "area": str(value.get("area") or recovered.get("area", "")),
        "city": str(value.get("city") or recovered.get("city", "")),
        "pincode": str(pincode or ""),
        "landmark": str(value.get("landmark") or recovered.get("landmark", "")),
        "latitude": latitude,
        "longitude": longitude,
        "is_default": bool(value.get("is_default", False)),
    }


def upgrade() -> None:
    bind = op.get_bind()
    accounts = sa.table(
        "accounts",
        sa.column("id", sa.Integer),
        sa.column("addresses", sa.JSON),
    )
    for account_id, addresses in bind.execute(sa.select(accounts.c.id, accounts.c.addresses)):
        if isinstance(addresses, str):
            try:
                addresses = json.loads(addresses)
            except json.JSONDecodeError:
                addresses = []
        if not isinstance(addresses, list):
            continue
        normalized = [_normalize_address(address) for address in addresses if isinstance(address, dict)]
        if normalized != addresses:
            bind.execute(sa.update(accounts).where(accounts.c.id == account_id).values(addresses=normalized))


def downgrade() -> None:
    bind = op.get_bind()
    accounts = sa.table(
        "accounts",
        sa.column("id", sa.Integer),
        sa.column("addresses", sa.JSON),
    )
    for account_id, addresses in bind.execute(sa.select(accounts.c.id, accounts.c.addresses)):
        if isinstance(addresses, str):
            try:
                addresses = json.loads(addresses)
            except json.JSONDecodeError:
                addresses = []
        if not isinstance(addresses, list):
            continue
        legacy = []
        for address in addresses:
            if not isinstance(address, dict):
                continue
            item = dict(address)
            item["postal_code"] = item.pop("pincode", "")
            item["address"] = ", ".join(
                part for part in (
                    item.pop("house_number", ""),
                    item.pop("road", ""),
                    item.pop("area", ""),
                    item.pop("city", ""),
                    item.get("postal_code", ""),
                ) if part
            )
            item.pop("latitude", None)
            item.pop("longitude", None)
            item.pop("landmark", None)
            legacy.append(item)
        bind.execute(sa.update(accounts).where(accounts.c.id == account_id).values(addresses=legacy))
