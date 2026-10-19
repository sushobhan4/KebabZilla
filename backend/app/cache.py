"""
In-memory caching layer for high-frequency backend endpoints.
Caches frequently requested queries and calculations (restaurant profile, menu,
delivery recommended batches, staff order queues, active driver counts) to
eliminate redundant database compute.
"""

import threading
import time
from typing import Any, Dict, Optional, Tuple


class SimpleTTLCache:
    """Thread-safe in-memory cache with Time-To-Live (TTL) expiration."""

    def __init__(self, default_ttl_seconds: float = 10.0, max_size: int = 512):
        self.default_ttl = default_ttl_seconds
        self.max_size = max_size
        self._cache: Dict[str, Tuple[Any, float]] = {}
        self._lock = threading.Lock()

    def get(self, key: str) -> Optional[Any]:
        with self._lock:
            entry = self._cache.get(key)
            if not entry:
                return None
            val, expire_at = entry
            if time.time() > expire_at:
                del self._cache[key]
                return None
            return val

    def set(self, key: str, value: Any, ttl_seconds: Optional[float] = None) -> None:
        ttl = ttl_seconds if ttl_seconds is not None else self.default_ttl
        expire_at = time.time() + ttl
        with self._lock:
            if len(self._cache) >= self.max_size and key not in self._cache:
                now = time.time()
                expired = [k for k, (_, exp) in self._cache.items() if now > exp]
                for k in expired:
                    del self._cache[k]
                if len(self._cache) >= self.max_size:
                    oldest_key = next(iter(self._cache))
                    del self._cache[oldest_key]
            self._cache[key] = (value, expire_at)

    def delete(self, key: str) -> None:
        with self._lock:
            self._cache.pop(key, None)

    def delete_prefix(self, prefix: str) -> None:
        with self._lock:
            matching = [k for k in self._cache if k.startswith(prefix)]
            for k in matching:
                del self._cache[k]

    def clear(self) -> None:
        with self._lock:
            self._cache.clear()


# Global cache instances
cache = SimpleTTLCache(default_ttl_seconds=15.0, max_size=1024)
auth_cache = SimpleTTLCache(default_ttl_seconds=60.0, max_size=2048)
image_cache = SimpleTTLCache(default_ttl_seconds=3600.0, max_size=128)

# Cache keys and prefixes
KEY_PUBLIC_RESTAURANT = "public_restaurant"
KEY_ADMIN_SETTINGS = "admin_settings"
KEY_MENU_CATEGORIES = "menu:categories"
KEY_ADMIN_DISCOUNTS = "admin:discounts"
KEY_ADMIN_OFFERS = "admin:offers"
KEY_ADMIN_ACCOUNTS = "admin:accounts"
KEY_EMAIL_STATUS = "admin:email_status"
KEY_CUSTOM_MENU_MANAGE = "menu:custom_manage"
KEY_STAFF_MENU = "menu:staff_list"
PREFIX_MENU = "menu:"
PREFIX_DELIVERY = "delivery:"
PREFIX_ORDERS = "orders:"
PREFIX_REPORTS = "reports:"
PREFIX_EVENTS = "admin:events:"


def invalidate_restaurant_cache() -> None:
    """Invalidate restaurant settings and public storefront caches."""
    cache.delete(KEY_PUBLIC_RESTAURANT)
    cache.delete(KEY_ADMIN_SETTINGS)
    cache.delete_prefix(PREFIX_DELIVERY)


def invalidate_menu_cache() -> None:
    """Invalidate public, categories, custom, and staff menu caches."""
    cache.delete_prefix(PREFIX_MENU)
    cache.delete(KEY_MENU_CATEGORIES)
    cache.delete(KEY_CUSTOM_MENU_MANAGE)
    cache.delete(KEY_STAFF_MENU)


def invalidate_delivery_cache() -> None:
    """Invalidate delivery recommended batches and active driver counts."""
    cache.delete_prefix(PREFIX_DELIVERY)


def invalidate_orders_cache() -> None:
    """Invalidate staff order queue, delivery batches, and sales reports."""
    cache.delete_prefix(PREFIX_ORDERS)
    cache.delete_prefix(PREFIX_DELIVERY)
    cache.delete_prefix(PREFIX_REPORTS)


def invalidate_discounts_cache() -> None:
    """Invalidate active discount lists, offers, and banners."""
    cache.delete(KEY_ADMIN_DISCOUNTS)
    cache.delete(KEY_ADMIN_OFFERS)
    cache.delete_prefix(PREFIX_MENU)


def invalidate_accounts_cache() -> None:
    """Invalidate team accounts and staff lists."""
    cache.delete(KEY_ADMIN_ACCOUNTS)
    cache.delete(KEY_ADMIN_SETTINGS)


def invalidate_auth_cache(token_hash: str | None = None) -> None:
    """Invalidate user session authentication cache."""
    if token_hash:
        auth_cache.delete(token_hash)
    else:
        auth_cache.clear()

