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


# Global cache instance
cache = SimpleTTLCache()

# Cache keys and prefixes
KEY_PUBLIC_RESTAURANT = "public_restaurant"
KEY_ADMIN_SETTINGS = "admin_settings"
PREFIX_MENU = "menu:"
PREFIX_DELIVERY = "delivery:"
PREFIX_ORDERS = "orders:"


def invalidate_restaurant_cache() -> None:
    """Invalidate restaurant settings and public storefront caches."""
    cache.delete(KEY_PUBLIC_RESTAURANT)
    cache.delete(KEY_ADMIN_SETTINGS)
    cache.delete_prefix(PREFIX_DELIVERY)


def invalidate_menu_cache() -> None:
    """Invalidate public and staff menu caches."""
    cache.delete_prefix(PREFIX_MENU)


def invalidate_delivery_cache() -> None:
    """Invalidate delivery recommended batches and active driver counts."""
    cache.delete_prefix(PREFIX_DELIVERY)


def invalidate_orders_cache() -> None:
    """Invalidate staff order queue and related delivery batch caches."""
    cache.delete_prefix(PREFIX_ORDERS)
    cache.delete_prefix(PREFIX_DELIVERY)
