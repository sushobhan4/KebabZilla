import time
import unittest

from app.cache import (
    KEY_ADMIN_SETTINGS,
    KEY_PUBLIC_RESTAURANT,
    PREFIX_DELIVERY,
    PREFIX_MENU,
    PREFIX_ORDERS,
    SimpleTTLCache,
    cache,
    invalidate_delivery_cache,
    invalidate_menu_cache,
    invalidate_orders_cache,
    invalidate_restaurant_cache,
)


class TestSimpleTTLCache(unittest.TestCase):
    def test_basic_get_set(self):
        c = SimpleTTLCache(default_ttl_seconds=5.0)
        c.set("k1", "v1")
        self.assertEqual(c.get("k1"), "v1")
        self.assertIsNone(c.get("nonexistent"))

    def test_ttl_expiration(self):
        c = SimpleTTLCache(default_ttl_seconds=0.05)
        c.set("expire_me", 42)
        self.assertEqual(c.get("expire_me"), 42)
        time.sleep(0.08)
        self.assertIsNone(c.get("expire_me"))

    def test_delete_and_clear(self):
        c = SimpleTTLCache()
        c.set("a", 1)
        c.set("b", 2)
        c.delete("a")
        self.assertIsNone(c.get("a"))
        self.assertEqual(c.get("b"), 2)
        c.clear()
        self.assertIsNone(c.get("b"))

    def test_delete_prefix(self):
        c = SimpleTTLCache()
        c.set("menu:1", "item1")
        c.set("menu:2", "item2")
        c.set("orders:1", "order1")
        c.delete_prefix("menu:")
        self.assertIsNone(c.get("menu:1"))
        self.assertIsNone(c.get("menu:2"))
        self.assertEqual(c.get("orders:1"), "order1")

    def test_max_size_eviction(self):
        c = SimpleTTLCache(default_ttl_seconds=60.0, max_size=3)
        c.set("k1", 1)
        c.set("k2", 2)
        c.set("k3", 3)
        c.set("k4", 4)
        # At most 3 items should be kept
        self.assertEqual(c.get("k4"), 4)

    def test_helper_invalidations(self):
        cache.clear()
        cache.set(KEY_PUBLIC_RESTAURANT, {"name": "KebabZilla"})
        cache.set(KEY_ADMIN_SETTINGS, {"status": "ok"})
        cache.set(f"{PREFIX_MENU}list", [{"id": 1}])
        cache.set(f"{PREFIX_DELIVERY}recommended_batches", {"batches": []})
        cache.set(f"{PREFIX_ORDERS}staff_all", [{"id": "101"}])

        invalidate_menu_cache()
        self.assertIsNone(cache.get(f"{PREFIX_MENU}list"))
        self.assertIsNotNone(cache.get(KEY_PUBLIC_RESTAURANT))

        invalidate_orders_cache()
        self.assertIsNone(cache.get(f"{PREFIX_ORDERS}staff_all"))
        self.assertIsNone(cache.get(f"{PREFIX_DELIVERY}recommended_batches"))

        cache.set(f"{PREFIX_DELIVERY}active_riders", 2)
        invalidate_delivery_cache()
        self.assertIsNone(cache.get(f"{PREFIX_DELIVERY}active_riders"))

        invalidate_restaurant_cache()
        self.assertIsNone(cache.get(KEY_PUBLIC_RESTAURANT))
        self.assertIsNone(cache.get(KEY_ADMIN_SETTINGS))


if __name__ == "__main__":
    unittest.main()
