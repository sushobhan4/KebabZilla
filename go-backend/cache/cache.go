package cache

import (
	"context"
	"sync"
	"time"

	"github.com/kebabzilla/go-backend/config"
	"github.com/redis/go-redis/v9"
)

type memoryItem struct {
	value     []byte
	expiresAt time.Time
	permanent bool
}

type HybridCache struct {
	mu     sync.RWMutex
	memory map[string]memoryItem
	rdb    *redis.Client
}

var Cache *HybridCache

func InitCache(cfg *config.Config) *HybridCache {
	c := &HybridCache{
		memory: make(map[string]memoryItem),
	}

	if cfg.RedisURL != "" {
		opt, err := redis.ParseURL(cfg.RedisURL)
		if err == nil {
			c.rdb = redis.NewClient(opt)
			// test connection with short timeout
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			_ = c.rdb.Ping(ctx).Err()
		}
	}

	Cache = c
	return c
}

func (c *HybridCache) Get(ctx context.Context, key string) ([]byte, bool) {
	// L1 RAM check
	c.mu.RLock()
	item, found := c.memory[key]
	c.mu.RUnlock()

	now := time.Now()
	if found {
		if item.permanent || item.expiresAt.After(now) {
			return item.value, true
		}
		// expired in memory
		c.mu.Lock()
		delete(c.memory, key)
		c.mu.Unlock()
	}

	// L2 Redis check
	if c.rdb != nil {
		val, err := c.rdb.Get(ctx, key).Bytes()
		if err == nil {
			// Backfill L1
			c.mu.Lock()
			c.memory[key] = memoryItem{
				value:     val,
				expiresAt: now.Add(15 * time.Second),
				permanent: false,
			}
			c.mu.Unlock()
			return val, true
		}
	}

	return nil, false
}

func (c *HybridCache) Set(ctx context.Context, key string, value []byte, ttl time.Duration, permanent bool) {
	// Write to L1 RAM
	c.mu.Lock()
	c.memory[key] = memoryItem{
		value:     value,
		expiresAt: time.Now().Add(ttl),
		permanent: permanent,
	}
	c.mu.Unlock()

	// Write to L2 Redis
	if c.rdb != nil {
		if permanent {
			_ = c.rdb.Set(ctx, key, value, 0).Err()
		} else {
			_ = c.rdb.Set(ctx, key, value, ttl).Err()
		}
	}
}

func (c *HybridCache) Delete(ctx context.Context, key string) {
	c.mu.Lock()
	delete(c.memory, key)
	c.mu.Unlock()

	if c.rdb != nil {
		_ = c.rdb.Del(ctx, key).Err()
	}
}

func (c *HybridCache) DeletePrefix(ctx context.Context, prefix string) {
	c.mu.Lock()
	for k := range c.memory {
		if len(k) >= len(prefix) && k[:len(prefix)] == prefix {
			delete(c.memory, k)
		}
	}
	c.mu.Unlock()

	if c.rdb != nil {
		iter := c.rdb.Scan(ctx, 0, prefix+"*", 0).Iterator()
		for iter.Next(ctx) {
			_ = c.rdb.Del(ctx, iter.Val()).Err()
		}
	}
}
