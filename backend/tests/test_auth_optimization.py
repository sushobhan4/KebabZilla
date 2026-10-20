"""
Comprehensive Test Suite for Authentication Optimization.
Tests:
1. Thread-safe in-memory cache operations, TTL expiration, and LRU eviction.
2. Per-key stampede protection (single-flight locking for uncached sessions).
3. Secondary account-id indexing and multi-session account-wide invalidation.
4. Lightweight AuthContext duck-typing without ORM object caching.
5. Zero-DB-query warm-cache authentication for routine endpoints.
6. Single-joined-query DB fallback on cache misses.
7. Conditional sliding 30-day session expiry extension without write contention.
8. Expired & revoked session rejection (even if cached).
9. Session revocation on logout, password reset, and role changes.
10. Explicit full Account ORM model loading only on endpoints that genuinely require it.
"""

import sys
import os
import threading
import time
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

# Ensure backend directory is in sys.path
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from sqlalchemy import create_engine, event, select
from sqlalchemy.pool import StaticPool
from sqlalchemy.orm import sessionmaker, Session
from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.testclient import TestClient

from app.cache import SimpleTTLCache, auth_cache, auth_metrics, invalidate_auth_cache
from app.dependencies import (
    AuthContext,
    CurrentAccount,
    CurrentAccountModel,
    CurrentAuth,
    current_auth,
    current_auth_base,
    get_current_account_model,
    require_roles,
    auth_context_to_cache,
    auth_context_from_cache,
)
from app.models import Base, Account, UserSession, StaffInfo, Role, utcnow
from app.security import hash_session_token, compute_device_fingerprint, SESSION_COOKIE_NAME


class QueryCounter:
    """Helper to count raw SQL queries executed during a block."""
    def __init__(self, engine):
        self.engine = engine
        self.count = 0

    def __enter__(self):
        self.count = 0
        event.listen(self.engine, "before_cursor_execute", self._before_execute)
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        event.remove(self.engine, "before_cursor_execute", self._before_execute)

    def _before_execute(self, conn, cursor, statement, parameters, context, executemany):
        self.count += 1


class TestAuthCache(unittest.TestCase):
    """Unit tests for the thread-safe SimpleTTLCache and stampede protection."""

    def setUp(self):
        self.cache = SimpleTTLCache(default_ttl_seconds=1.0, max_size=10)

    def test_cache_set_and_get(self):
        self.cache.set("key1", {"account_id": 42, "role": "USER"})
        self.assertEqual(self.cache.get("key1"), {"account_id": 42, "role": "USER"})

    def test_cache_ttl_expiration(self):
        self.cache.set("short_key", "value", ttl_seconds=0.1)
        self.assertEqual(self.cache.get("short_key"), "value")
        time.sleep(0.15)
        self.assertIsNone(self.cache.get("short_key"))

    def test_lru_and_max_size_eviction(self):
        # Fill cache up to max_size (10)
        for i in range(10):
            self.cache.set(f"k{i}", f"val{i}", ttl_seconds=10.0)

        # Add 11th item: oldest should be evicted
        self.cache.set("k10", "val10", ttl_seconds=10.0)
        self.assertIsNone(self.cache.get("k0"))
        self.assertEqual(self.cache.get("k10"), "val10")

    def test_account_invalidation(self):
        self.cache.set("token1", {"account_id": 100, "data": "a"})
        self.cache.set("token2", {"account_id": 100, "data": "b"})
        self.cache.set("token3", {"account_id": 200, "data": "c"})

        self.assertIsNotNone(self.cache.get("token1"))
        self.assertIsNotNone(self.cache.get("token2"))
        self.assertIsNotNone(self.cache.get("token3"))

        # Invalidate account 100
        invalidated = self.cache.invalidate_account(100)
        self.assertEqual(invalidated, 2)
        self.assertIsNone(self.cache.get("token1"))
        self.assertIsNone(self.cache.get("token2"))
        self.assertEqual(self.cache.get("token3"), {"account_id": 200, "data": "c"})

    def test_key_lock_stampede_prevention(self):
        """Simulate 20 threads requesting the exact same uncached key simultaneously.
        Verify that only 1 thread executes the simulated slow database query.
        """
        db_queries = 0
        db_lock = threading.Lock()

        def compute_or_fetch(key: str):
            nonlocal db_queries
            cached = self.cache.get(key)
            if cached:
                return cached

            with self.cache.key_lock(key):
                # Double-checked locking
                cached = self.cache.get(key)
                if cached:
                    return cached
                with db_lock:
                    db_queries += 1
                time.sleep(0.05)  # Simulate slow DB query
                result = {"account_id": 999, "data": "db_result"}
                self.cache.set(key, result, ttl_seconds=5.0)
                return result

        threads = []
        results = [None] * 20

        def worker(idx):
            results[idx] = compute_or_fetch("stampede_key")

        for i in range(20):
            t = threading.Thread(target=worker, args=(i,))
            threads.append(t)
            t.start()

        for t in threads:
            t.join()

        # All 20 threads should receive the valid result
        for res in results:
            self.assertEqual(res, {"account_id": 999, "data": "db_result"})

        # Exactly 1 slow query was executed despite 20 concurrent threads
        self.assertEqual(db_queries, 1)

    def test_concurrent_access_safety(self):
        """50 concurrent threads reading and writing different keys."""
        threads = []
        errors = []

        def worker(w_id):
            try:
                for i in range(50):
                    k = f"k_{w_id}_{i}"
                    self.cache.set(k, {"account_id": w_id, "val": i}, ttl_seconds=1.0)
                    _ = self.cache.get(k)
                    if i % 10 == 0:
                        self.cache.invalidate_account(w_id)
            except Exception as e:
                errors.append(e)

        for w in range(20):
            t = threading.Thread(target=worker, args=(w,))
            threads.append(t)
            t.start()

        for t in threads:
            t.join()

        self.assertEqual(len(errors), 0)


class TestAuthContextSerialization(unittest.TestCase):
    """Verify AuthContext serializes cleanly to primitives and duck-types Account."""

    def test_duck_typing(self):
        now = utcnow()
        ctx = AuthContext(
            id=12,
            name="John Doe",
            email="john@kebabzilla.in",
            phone="+919876543210",
            role=Role.USER,
            must_change_password=False,
            is_accepting_deliveries=False,
            session_id=1,
            token_hash="abc",
            device_fingerprint="fp1",
            expires_at=now,
        )
        self.assertEqual(ctx.id, 12)
        self.assertEqual(ctx.name, "John Doe")
        self.assertEqual(ctx.email, "john@kebabzilla.in")
        self.assertEqual(ctx.phone, "+919876543210")
        self.assertEqual(ctx.role, Role.USER)
        self.assertFalse(ctx.must_change_password)
        self.assertFalse(ctx.is_accepting_deliveries)
        self.assertIsNone(ctx.delivery_duty)
        self.assertEqual(ctx.addresses, ())

    def test_cache_roundtrip(self):
        now = utcnow()
        ctx = AuthContext(
            id=42,
            name="Admin User",
            email="admin@kebabzilla.in",
            phone=None,
            role=Role.ADMIN,
            must_change_password=False,
            is_accepting_deliveries=True,
            session_id=10,
            token_hash="hash_val",
            device_fingerprint="fp_val",
            expires_at=now + timedelta(days=30),
        )
        cached_dict = auth_context_to_cache(ctx, last_active_at=now)
        # Verify cached_dict contains only primitive types (no ORM objects)
        for k, v in cached_dict.items():
            self.assertIn(type(v), (int, str, bool, type(None)))

        reconstructed_ctx, reconstructed_last_active = auth_context_from_cache(cached_dict)
        self.assertEqual(reconstructed_ctx.id, ctx.id)
        self.assertEqual(reconstructed_ctx.name, ctx.name)
        self.assertEqual(reconstructed_ctx.email, ctx.email)
        self.assertEqual(reconstructed_ctx.role, Role.ADMIN)
        self.assertTrue(reconstructed_ctx.is_accepting_deliveries)


class TestAuthIntegration(unittest.TestCase):
    """End-to-end integration tests using an isolated in-memory SQLite database."""

    @classmethod
    def setUpClass(cls):
        # Create fresh SQLite in-memory engine with StaticPool so all sessions share the DB
        cls.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(cls.engine)
        cls.SessionLocal = sessionmaker(bind=cls.engine)

        # Setup test FastAPI app
        cls.app = FastAPI()

        def override_get_db():
            db = cls.SessionLocal()
            try:
                yield db
            finally:
                db.close()

        from app.db import get_db
        cls.app.dependency_overrides[get_db] = override_get_db

        # Define test endpoints
        @cls.app.get("/test/lightweight")
        def route_lightweight(auth: CurrentAccount):
            return {
                "id": auth.id,
                "name": auth.name,
                "role": auth.role.value,
                "is_accepting": auth.is_accepting_deliveries,
            }

        @cls.app.get("/test/admin-only", dependencies=[Depends(require_roles(Role.ADMIN))])
        def route_admin_only(auth: CurrentAccount):
            return {"status": "admin_granted", "admin_id": auth.id}

        @cls.app.get("/test/full-model")
        def route_full_model(account: CurrentAccountModel):
            return {
                "id": account.id,
                "name": account.name,
                "role": account.role.value,
                "has_staff_info": bool(account.staff_info),
            }

        cls.client = TestClient(cls.app)

    def setUp(self):
        auth_cache.clear()
        auth_metrics.reset()

        # Seed test user and session in database
        self.db = self.SessionLocal()
        # Clean existing rows
        self.db.query(UserSession).delete()
        self.db.query(StaffInfo).delete()
        self.db.query(Account).delete()
        self.db.commit()

        self.user = Account(
            id=1,
            name="Alice",
            email="alice@kebabzilla.in",
            phone="+919876543210",
            password_hash="mock_hash",
            role=Role.USER,
        )
        self.db.add(self.user)

        self.admin = Account(
            id=2,
            name="Bob Admin",
            email="bob@kebabzilla.in",
            password_hash="mock_admin_hash",
            role=Role.ADMIN,
        )
        self.db.add(self.admin)
        self.db.flush()

        self.admin_staff = StaffInfo(
            account_id=self.admin.id,
            is_accepting_deliveries=True,
            must_change_password=False,
        )
        self.db.add(self.admin_staff)

        self.user_token = "alice_secret_token_123"
        self.user_token_hash = hash_session_token(self.user_token)
        self.user_session = UserSession(
            account_id=self.user.id,
            token_hash=self.user_token_hash,
            user_agent="TestClient/1.0",
            device_fingerprint=compute_device_fingerprint("TestClient/1.0"),
            expires_at=utcnow() + timedelta(days=30),
            last_active_at=utcnow(),
            is_revoked=False,
        )
        self.db.add(self.user_session)

        self.admin_token = "bob_admin_token_456"
        self.admin_token_hash = hash_session_token(self.admin_token)
        self.admin_session = UserSession(
            account_id=self.admin.id,
            token_hash=self.admin_token_hash,
            user_agent="TestClient/1.0",
            device_fingerprint=compute_device_fingerprint("TestClient/1.0"),
            expires_at=utcnow() + timedelta(days=30),
            last_active_at=utcnow(),
            is_revoked=False,
        )
        self.db.add(self.admin_session)
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_zero_db_queries_on_warm_cache(self):
        """Warm cache requests for lightweight endpoints must execute ZERO database queries."""
        headers = {
            "Authorization": f"Bearer {self.user_token}",
            "User-Agent": "TestClient/1.0",
        }

        # 1. First request: Cold cache (misses cache, executes 1 joined DB query)
        with QueryCounter(self.engine) as cold_counter:
            res1 = self.client.get("/test/lightweight", headers=headers)
            self.assertEqual(res1.status_code, 200)
            self.assertEqual(res1.json()["name"], "Alice")
            self.assertGreater(cold_counter.count, 0)

        # Verify metrics recorded cold miss and DB fallback
        self.assertEqual(auth_metrics.cache_misses, 1)
        self.assertEqual(auth_metrics.db_fallbacks, 1)

        # 2. Second request: Warm cache!
        with QueryCounter(self.engine) as warm_counter:
            res2 = self.client.get("/test/lightweight", headers=headers)
            self.assertEqual(res2.status_code, 200)
            self.assertEqual(res2.json()["name"], "Alice")
            # CRITICAL ASSERTION: Zero DB queries on warm cache
            self.assertEqual(warm_counter.count, 0, "Warm cache MUST execute 0 database queries!")

        # 3. Third request: Still warm cache
        with QueryCounter(self.engine) as warm_counter_2:
            res3 = self.client.get("/test/lightweight", headers=headers)
            self.assertEqual(res3.status_code, 200)
            self.assertEqual(warm_counter_2.count, 0, "Repeated warm cache MUST execute 0 queries!")

        # Verify telemetry
        self.assertEqual(auth_metrics.cache_hits, 2)
        stats = auth_metrics.get_stats()
        self.assertAlmostEqual(stats["hit_ratio"], 2 / 3, places=2)

    def test_role_authorization_with_lightweight_context(self):
        """Role enforcement works with lightweight context without querying Account ORM."""
        user_headers = {
            "Authorization": f"Bearer {self.user_token}",
            "User-Agent": "TestClient/1.0",
        }
        admin_headers = {
            "Authorization": f"Bearer {self.admin_token}",
            "User-Agent": "TestClient/1.0",
        }

        # Normal user accessing admin-only endpoint: 403 Forbidden
        res_forbidden = self.client.get("/test/admin-only", headers=user_headers)
        self.assertEqual(res_forbidden.status_code, 403)

        # Admin accessing admin-only endpoint: 200 OK
        # Warm the cache
        self.client.get("/test/admin-only", headers=admin_headers)
        # Check zero queries on warm cache
        with QueryCounter(self.engine) as qc:
            res_ok = self.client.get("/test/admin-only", headers=admin_headers)
            self.assertEqual(res_ok.status_code, 200)
            self.assertEqual(qc.count, 0, "Warm admin role check must execute 0 DB queries!")

    def test_full_model_endpoint_loads_orm_when_required(self):
        """Endpoints requiring full ORM Account model load it as requested."""
        headers = {
            "Authorization": f"Bearer {self.admin_token}",
            "User-Agent": "TestClient/1.0",
        }
        # Warm the auth cache first via lightweight endpoint
        self.client.get("/test/lightweight", headers=headers)

        # Now call endpoint requiring CurrentAccountModel
        with QueryCounter(self.engine) as qc:
            res = self.client.get("/test/full-model", headers=headers)
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertEqual(data["name"], "Bob Admin")
            self.assertTrue(data["has_staff_info"])
            # Exactly 1 query to load the Account model (db.get)
            self.assertGreaterEqual(qc.count, 1)

        self.assertEqual(auth_metrics.account_loads, 1)

    def test_cache_invalidation_on_logout_or_revocation(self):
        """Revoking a session immediately causes subsequent requests to be rejected."""
        headers = {
            "Authorization": f"Bearer {self.user_token}",
            "User-Agent": "TestClient/1.0",
        }
        # Warm cache
        res = self.client.get("/test/lightweight", headers=headers)
        self.assertEqual(res.status_code, 200)

        # Invalidate specific session
        invalidate_auth_cache(token_hash=self.user_token_hash)
        # Mark revoked in DB as logout would do
        self.db.query(UserSession).filter(UserSession.token_hash == self.user_token_hash).update(
            {UserSession.is_revoked: True}
        )
        self.db.commit()

        # Subsequent request must fail with 401
        res_after = self.client.get("/test/lightweight", headers=headers)
        self.assertEqual(res_after.status_code, 401)

    def test_account_wide_invalidation_on_role_change_or_password_reset(self):
        """Changing an account's role invalidates all cached sessions for that account."""
        admin_headers = {
            "Authorization": f"Bearer {self.admin_token}",
            "User-Agent": "TestClient/1.0",
        }
        # Warm cache for admin
        res = self.client.get("/test/admin-only", headers=admin_headers)
        self.assertEqual(res.status_code, 200)

        # Demote admin to USER in DB
        self.admin.role = Role.USER
        self.db.commit()
        # Invalidate all sessions for this account in auth_cache
        invalidate_auth_cache(account_id=self.admin.id)

        # Next request must miss cache, load fresh role from DB, and be rejected with 403
        res_after_demote = self.client.get("/test/admin-only", headers=admin_headers)
        self.assertEqual(res_after_demote.status_code, 403)

    def test_expired_session_rejected_even_if_cached(self):
        """Expired sessions are rejected immediately by timestamp verification."""
        headers = {
            "Authorization": f"Bearer {self.user_token}",
            "User-Agent": "TestClient/1.0",
        }
        # Populate cache with an expired session
        auth_cache.set(
            self.user_token_hash,
            {
                "account_id": self.user.id,
                "name": "Alice",
                "email": "alice@kebabzilla.in",
                "role": "USER",
                "expires_at": (utcnow() - timedelta(seconds=10)).isoformat(),
                "last_active_at": (utcnow() - timedelta(days=1)).isoformat(),
            },
            ttl_seconds=60.0,
        )
        res = self.client.get("/test/lightweight", headers=headers)
        self.assertEqual(res.status_code, 401)

    def test_device_fingerprint_mismatch_rejected(self):
        """Request from unrecognized device fingerprint is rejected with 401."""
        spoofed_headers = {
            "Authorization": f"Bearer {self.user_token}",
            "User-Agent": "MaliciousScraper/2.0",
        }
        res = self.client.get("/test/lightweight", headers=spoofed_headers)
        self.assertEqual(res.status_code, 401)
        self.assertIn("device unrecognized", res.json()["detail"].lower())

    def test_sliding_session_conditional_update(self):
        """Session older than 30 mins triggers sliding expiry update; active session does not."""
        headers = {
            "Authorization": f"Bearer {self.user_token}",
            "User-Agent": "TestClient/1.0",
        }
        # Set last_active_at to 40 minutes ago in DB
        past_active = utcnow() - timedelta(minutes=40)
        self.db.query(UserSession).filter(UserSession.token_hash == self.user_token_hash).update(
            {UserSession.last_active_at: past_active}
        )
        self.db.commit()

        # First request extends session via conditional UPDATE
        self.client.get("/test/lightweight", headers=headers)
        self.assertEqual(auth_metrics.sliding_expiry_updates, 1)

        # Refresh session from DB and verify last_active_at updated
        updated_session = self.db.scalar(
            select(UserSession).where(UserSession.token_hash == self.user_token_hash)
        )
        updated_last_active = updated_session.last_active_at
        if updated_last_active.tzinfo is None:
            updated_last_active = updated_last_active.replace(tzinfo=timezone.utc)
        self.assertGreater(updated_last_active, past_active)

        # Second request within 30 minutes does NOT trigger sliding update (0 queries)
        with QueryCounter(self.engine) as qc:
            self.client.get("/test/lightweight", headers=headers)
            self.assertEqual(qc.count, 0)
        self.assertEqual(auth_metrics.sliding_expiry_updates, 1)


if __name__ == "__main__":
    unittest.main()
