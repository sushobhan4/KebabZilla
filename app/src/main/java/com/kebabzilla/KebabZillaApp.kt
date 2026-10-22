package com.kebabzilla

import android.app.Application
import coil.Coil
import coil.ImageLoader
import coil.disk.DiskCache
import coil.memory.MemoryCache
import coil.request.CachePolicy
import com.kebabzilla.data.local.CartManager

class KebabZillaApp : Application() {

    override fun onCreate() {
        super.onCreate()

        // 1. Configure aggressive persistent image disk caching with Coil
        val imageLoader = ImageLoader.Builder(this)
            .allowHardware(false) // Disallow hardware bitmaps so views can be safely snapshot by offscreen canvas/glass backdrop
            .memoryCache {
                MemoryCache.Builder(this)
                    .maxSizePercent(0.25)
                    .build()
            }
            .diskCache {
                DiskCache.Builder()
                    .directory(cacheDir.resolve("image_cache"))
                    .maxSizeBytes(150L * 1024 * 1024) // 150 MB persistent image disk cache
                    .build()
            }
            .diskCachePolicy(CachePolicy.ENABLED)
            .memoryCachePolicy(CachePolicy.ENABLED)
            .networkCachePolicy(CachePolicy.ENABLED)
            .respectCacheHeaders(false) // Cache images aggressively even if backend omits caching headers
            .build()
        Coil.setImageLoader(imageLoader)

        // 2. Initialize persistent cart manager (rehydrates active cart from local storage)
        CartManager.initialize(this)

        // 3. Initialize user-selected theme (System by default, Light or Dark)
        com.kebabzilla.utils.ThemeManager.initTheme(this)
    }
}
