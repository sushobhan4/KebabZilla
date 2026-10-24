package cache

import (
	"context"
	"testing"
	"time"

	"github.com/kebabzilla/go-backend/config"
)

func TestHybridCacheL1Memory(t *testing.T) {
	cfg := &config.Config{
		RedisURL: "", // No redis, test in-memory fallback
	}
	c := InitCache(cfg)
	ctx := context.Background()

	// 1. Set and Get
	key := "test:item:1"
	val := []byte("kebab-special-value")
	c.Set(ctx, key, val, 10*time.Minute, false)

	retrieved, found := c.Get(ctx, key)
	if !found {
		t.Fatalf("Expected key %s to be found", key)
	}
	if string(retrieved) != string(val) {
		t.Errorf("Expected %s, got %s", string(val), string(retrieved))
	}

	// 2. Delete
	c.Delete(ctx, key)
	_, found = c.Get(ctx, key)
	if found {
		t.Errorf("Expected key %s to be deleted", key)
	}

	// 3. DeletePrefix
	c.Set(ctx, "menu:item:1", []byte("1"), 10*time.Minute, false)
	c.Set(ctx, "menu:item:2", []byte("2"), 10*time.Minute, false)
	c.Set(ctx, "user:profile:1", []byte("profile"), 10*time.Minute, false)

	c.DeletePrefix(ctx, "menu:")

	_, found1 := c.Get(ctx, "menu:item:1")
	_, found2 := c.Get(ctx, "menu:item:2")
	_, found3 := c.Get(ctx, "user:profile:1")

	if found1 || found2 {
		t.Errorf("Prefix delete failed to remove matching keys")
	}
	if !found3 {
		t.Errorf("Prefix delete removed non-matching key")
	}

	// 4. Expiry
	shortKey := "short:ttl"
	c.Set(ctx, shortKey, []byte("expires-fast"), 10*time.Millisecond, false)
	time.Sleep(20 * time.Millisecond)
	_, foundExpired := c.Get(ctx, shortKey)
	if foundExpired {
		t.Errorf("Expired key was still returned")
	}
}
