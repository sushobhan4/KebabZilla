"""
In-memory caching layer for high-frequency backend endpoints.
Caches frequently requested queries and calculations (restaurant profile, menu,
delivery recommended batches, staff order queues, active driver counts) to
eliminate redundant database compute.
"""

import logging
import pickle
import threading
import time
from contextlib import contextmanager
from typing import Any, Dict, Optional, Set, Tuple

logger = logging.getLogger(__name__)


class AuthMetrics:
    """Thread-safe telemetry for authentication and session caching performance.
    Tracks hits, misses, database fallbacks, account lookups, sliding updates,
    and invalidations without logging sensitive credentials or tokens.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.cache_hits: int = 0
        self.cache_misses: int = 0
        self.db_fallbacks: int = 0
        self.account_loads: int = 0
        self.sliding_expiry_updates: int = 0
        self.invalidation_count: int = 0
        self.invalidation_failures: int = 0
        self.total_auth_latency_ms: float = 0.0
        self.auth_calls: int = 0

    def record_hit(self) -> None:
        with self._lock:
            self.cache_hits += 1

    def record_miss(self) -> None:
        with self._lock:
            self.cache_misses += 1

    def record_db_fallback(self) -> None:
        with self._lock:
            self.db_fallbacks += 1

    def record_account_load(self) -> None:
        with self._lock:
            self.account_loads += 1

    def record_sliding_expiry_update(self) -> None:
        with self._lock:
            self.sliding_expiry_updates += 1

    def record_invalidation(self, count: int = 1) -> None:
        with self._lock:
            self.invalidation_count += count

    def record_invalidation_failure(self) -> None:
        with self._lock:
            self.invalidation_failures += 1

    def record_auth_latency(self, latency_ms: float) -> None:
        with self._lock:
            self.total_auth_latency_ms += latency_ms
            self.auth_calls += 1

    def get_stats(self) -> dict[str, Any]:
        with self._lock:
            total_lookups = self.cache_hits + self.cache_misses
            hit_ratio = (self.cache_hits / total_lookups) if total_lookups > 0 else 0.0
            avg_latency = (self.total_auth_latency_ms / self.auth_calls) if self.auth_calls > 0 else 0.0
            return {
                "cache_hits": self.cache_hits,
                "cache_misses": self.cache_misses,
                "hit_ratio": round(hit_ratio, 4),
                "db_fallbacks": self.db_fallbacks,
                "account_loads": self.account_loads,
                "sliding_expiry_updates": self.sliding_expiry_updates,
                "invalidation_count": self.invalidation_count,
                "invalidation_failures": self.invalidation_failures,
                "avg_auth_latency_ms": round(avg_latency, 3),
                "total_auth_calls": self.auth_calls,
            }

    def reset(self) -> None:
        with self._lock:
            self.cache_hits = 0
            self.cache_misses = 0
            self.db_fallbacks = 0
            self.account_loads = 0
            self.sliding_expiry_updates = 0
            self.invalidation_count = 0
            self.invalidation_failures = 0
            self.total_auth_latency_ms = 0.0
            self.auth_calls = 0


auth_metrics = AuthMetrics()


class SimpleTTLCache:
    """Thread-safe in-memory cache with Time-To-Live (TTL) expiration,
    secondary account indexing, per-key stampede protection, and LRU eviction.
    """

    def __init__(self, default_ttl_seconds: float = 10.0, max_size: int = 512):
        self.default_ttl = default_ttl_seconds
        self.max_size = max_size
        self._cache: Dict[str, Tuple[Any, float]] = {}
        self._lock = threading.Lock()
        # Per-key locks for stampede protection
        self._key_locks: Dict[str, threading.Lock] = {}
        self._key_locks_lock = threading.Lock()
        self._key_lock_refs: Dict[str, int] = {}
        # Secondary index: account_id -> set of cache keys
        self._account_index: Dict[int, Set[str]] = {}

    def get(self, key: str) -> Optional[Any]:
        with self._lock:
            entry = self._cache.get(key)
            if not entry:
                return None
            val, expire_at = entry
            if time.time() > expire_at:
                self._delete_locked(key)
                return None
            return val

    def set(
        self,
        key: str,
        value: Any,
        ttl_seconds: Optional[float] = None,
        account_id: Optional[int] = None,
    ) -> None:
        ttl = ttl_seconds if ttl_seconds is not None else self.default_ttl
        expire_at = time.time() + ttl
        if account_id is None and isinstance(value, dict) and "account_id" in value:
            account_id = value["account_id"]

        with self._lock:
            if len(self._cache) >= self.max_size and key not in self._cache:
                now = time.time()
                expired = [k for k, (_, exp) in self._cache.items() if now > exp]
                for k in expired:
                    self._delete_locked(k)
                if len(self._cache) >= self.max_size:
                    oldest_key = next(iter(self._cache))
                    self._delete_locked(oldest_key)

            self._cache[key] = (value, expire_at)
            if account_id is not None:
                self._account_index.setdefault(account_id, set()).add(key)

    def _delete_locked(self, key: str) -> None:
        entry = self._cache.pop(key, None)
        if entry:
            val, _ = entry
            if isinstance(val, dict) and "account_id" in val:
                acc_id = val["account_id"]
                if acc_id in self._account_index:
                    self._account_index[acc_id].discard(key)
                    if not self._account_index[acc_id]:
                        self._account_index.pop(acc_id, None)

    def delete(self, key: str) -> None:
        with self._lock:
            self._delete_locked(key)

    def invalidate_account(self, account_id: int) -> int:
        """Invalidate all cache entries associated with an account ID."""
        with self._lock:
            keys = self._account_index.pop(account_id, set())
            for k, (val, _) in list(self._cache.items()):
                if isinstance(val, dict) and val.get("account_id") == account_id:
                    keys.add(k)
            for k in keys:
                self._cache.pop(k, None)
            return len(keys)

    def delete_prefix(self, prefix: str) -> None:
        with self._lock:
            matching = [k for k in self._cache if k.startswith(prefix)]
            for k in matching:
                self._delete_locked(k)

    def clear(self) -> None:
        with self._lock:
            self._cache.clear()
            self._account_index.clear()

    @contextmanager
    def key_lock(self, key: str):
        """Acquire a per-key lock to coordinate concurrent cache misses and prevent cache stampedes.
        Requests for different keys run completely in parallel.
        Requests for the same key serialize so only the first request performs the slow database lookup.
        """
        with self._key_locks_lock:
            lock = self._key_locks.get(key)
            if lock is None:
                lock = threading.Lock()
                self._key_locks[key] = lock
            self._key_lock_refs[key] = self._key_lock_refs.get(key, 0) + 1

        lock.acquire()
        try:
            yield
        finally:
            lock.release()
            with self._key_locks_lock:
                self._key_lock_refs[key] -= 1
                if self._key_lock_refs[key] <= 0:
                    self._key_locks.pop(key, None)
                    self._key_lock_refs.pop(key, None)


class RedisTTLCache:
    """Distributed Redis cache with thread-safe in-memory fallback.
    Provides cross-instance session synchronization and query caching.
    Falls back gracefully to SimpleTTLCache if Redis is unavailable or unconfigured.
    """

    def __init__(self, redis_client: Any, prefix: str = "kz:", default_ttl_seconds: float = 15.0, max_size: int = 1024):
        self.client = redis_client
        self.prefix = prefix
        self.default_ttl = default_ttl_seconds
        self.fallback = SimpleTTLCache(default_ttl_seconds=default_ttl_seconds, max_size=max_size)

    def _format_key(self, key: str) -> str:
        return f"{self.prefix}{key}"

    def get(self, key: str) -> Optional[Any]:
        if not self.client:
            return self.fallback.get(key)
        try:
            raw = self.client.get(self._format_key(key))
            if raw is None:
                return None
            return pickle.loads(raw)
        except Exception as exc:
            logger.warning("Redis GET failed for %s, falling back to memory: %s", key, exc)
            return self.fallback.get(key)

    def set(
        self,
        key: str,
        value: Any,
        ttl_seconds: Optional[float] = None,
        account_id: Optional[int] = None,
    ) -> None:
        ttl = int(ttl_seconds if ttl_seconds is not None else self.default_ttl)
        if account_id is None and isinstance(value, dict) and "account_id" in value:
            account_id = value["account_id"]

        if not self.client:
            self.fallback.set(key, value, ttl_seconds=ttl, account_id=account_id)
            return

        try:
            dumped = pickle.dumps(value, protocol=pickle.HIGHEST_PROTOCOL)
            full_key = self._format_key(key)
            self.client.set(full_key, dumped, ex=max(ttl, 1))
            if account_id is not None:
                acc_idx_key = f"{self.prefix}acc_idx:{account_id}"
                self.client.sadd(acc_idx_key, full_key)
                self.client.expire(acc_idx_key, max(ttl * 2, 86400))
        except Exception as exc:
            logger.warning("Redis SET failed for %s, falling back to memory: %s", key, exc)
            self.fallback.set(key, value, ttl_seconds=ttl, account_id=account_id)

    def delete(self, key: str) -> None:
        if self.client:
            try:
                self.client.delete(self._format_key(key))
            except Exception as exc:
                logger.warning("Redis DELETE failed for %s: %s", key, exc)
        self.fallback.delete(key)

    def invalidate_account(self, account_id: int) -> int:
        count = 0
        if self.client:
            try:
                acc_idx_key = f"{self.prefix}acc_idx:{account_id}"
                keys = self.client.smembers(acc_idx_key)
                if keys:
                    key_list = [k.decode("utf-8") if isinstance(k, bytes) else str(k) for k in keys]
                    self.client.delete(*key_list)
                    count = len(key_list)
                self.client.delete(acc_idx_key)
            except Exception as exc:
                logger.warning("Redis invalidate_account failed for %s: %s", account_id, exc)
        mem_count = self.fallback.invalidate_account(account_id)
        return max(count, mem_count)

    def delete_prefix(self, prefix: str) -> None:
        if self.client:
            try:
                pattern = f"{self.prefix}{prefix}*"
                cursor = 0
                keys_to_delete = []
                while True:
                    cursor, keys = self.client.scan(cursor=cursor, match=pattern, count=100)
                    if keys:
                        keys_to_delete.extend(keys)
                    if cursor == 0:
                        break
                if keys_to_delete:
                    self.client.delete(*keys_to_delete)
            except Exception as exc:
                logger.warning("Redis delete_prefix failed for %s: %s", prefix, exc)
        self.fallback.delete_prefix(prefix)

    def clear(self) -> None:
        if self.client:
            try:
                self.delete_prefix("")
            except Exception as exc:
                logger.warning("Redis clear failed: %s", exc)
        self.fallback.clear()

    @contextmanager
    def key_lock(self, key: str):
        if not self.client:
            with self.fallback.key_lock(key):
                yield
            return
        lock_name = f"{self.prefix}lock:{key}"
        try:
            with self.client.lock(lock_name, timeout=5.0, blocking_timeout=2.0):
                yield
        except Exception:
            with self.fallback.key_lock(key):
                yield


def init_redis_client() -> Any:
    try:
        from app.config import settings
        if not getattr(settings, "redis_url", None):
            return None
        import redis
        pool = redis.ConnectionPool.from_url(
            settings.redis_url,
            max_connections=50,
            socket_connect_timeout=2.0,
            socket_timeout=2.0,
            retry_on_timeout=True,
        )
        client = redis.Redis(connection_pool=pool)
        client.ping()
        logger.info("Connected to Redis cache successfully")
        return client
    except Exception as exc:
        logger.warning("Could not connect to Redis (%s). Using in-memory cache.", exc)
        return None


_redis_client = init_redis_client()

# Global cache instances (backed by Redis when configured, in-memory otherwise)
cache = RedisTTLCache(_redis_client, prefix="kz:data:", default_ttl_seconds=15.0, max_size=1024)
auth_cache = RedisTTLCache(_redis_client, prefix="kz:auth:", default_ttl_seconds=60.0, max_size=2048)
image_cache = RedisTTLCache(_redis_client, prefix="kz:img:", default_ttl_seconds=3600.0, max_size=128)

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


def invalidate_auth_cache(token_hash: str | None = None, account_id: int | None = None) -> None:
    """Invalidate user session authentication cache.
    - If account_id is provided, invalidates ALL cached sessions for that account.
    - If token_hash is provided, invalidates that specific session.
    - If neither is provided, clears the entire auth cache.

    Note: The in-memory cache is instance-local. In a multi-worker / multi-instance
    deployment (such as Google Cloud Run), other instances rely on bounded TTL
    expiration (default 60s) for eventual consistency.
    """
    try:
        if account_id is not None:
            count = auth_cache.invalidate_account(account_id)
            auth_metrics.record_invalidation(count if count > 0 else 1)
        elif token_hash is not None:
            auth_cache.delete(token_hash)
            auth_metrics.record_invalidation(1)
        else:
            auth_cache.clear()
            auth_metrics.record_invalidation(1)
    except Exception as exc:
        auth_metrics.record_invalidation_failure()
        logger.error("Failed to invalidate auth cache: %s", exc)

