package com.kebabzilla.data.local

import android.content.Context
import android.os.Handler
import android.os.Looper
import com.kebabzilla.data.api.ApiClient
import com.kebabzilla.data.api.NetworkResult
import com.kebabzilla.data.model.CartLine
import com.kebabzilla.data.model.DeliveryEstimate
import com.kebabzilla.data.model.MenuItem
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

object CartManager {

    private val lines = mutableMapOf<String, CartLine>()
    private val listeners = mutableListOf<() -> Unit>()

    var deliveryEstimate: DeliveryEstimate? = null
    var deliveryFeePaise: Long = 0L
    var rawDeliveryFeePaise: Long = 0L
    var roundOffPaise: Long = 0L
    var isOutsideDeliveryZone: Boolean = false
    var isFreeDeliveryByThreshold: Boolean = false

    private var cacheManager: DataCacheManager? = null
    private var apiClient: ApiClient? = null
    private var tokenManager: TokenManager? = null

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var syncJob: Job? = null
    private var mainHandler: Handler? = null

    fun initialize(context: Context, client: ApiClient? = null) {
        val appCtx = context.applicationContext
        cacheManager = DataCacheManager(appCtx)
        apiClient = client ?: ApiClient(appCtx)
        tokenManager = TokenManager(appCtx)

        // 1. Immediately rehydrate cart from persistent local storage (0ms latency / offline-ready)
        val cached = cacheManager?.getCachedCartLines().orEmpty()
        if (cached.isNotEmpty()) {
            lines.clear()
            for (line in cached) {
                lines[line.lineKey] = line
            }
            notifyChanged()
        }

        // 2. If user is logged in, sync from remote database in background
        if (tokenManager?.isLoggedIn() == true) {
            syncFromRemote()
        }
    }

    fun addListener(listener: () -> Unit) {
        if (!listeners.contains(listener)) {
            listeners.add(listener)
        }
    }

    fun removeListener(listener: () -> Unit) {
        listeners.remove(listener)
    }

    private fun notifyChanged() {
        try {
            val mainLooper = Looper.getMainLooper()
            if (mainLooper != null && Looper.myLooper() == mainLooper) {
                listeners.forEach { it.invoke() }
            } else if (mainLooper != null) {
                if (mainHandler == null) {
                    mainHandler = Handler(mainLooper)
                }
                mainHandler?.post {
                    listeners.forEach { it.invoke() }
                }
            } else {
                listeners.forEach { it.invoke() }
            }
        } catch (_: Throwable) {
            listeners.forEach { it.invoke() }
        }
    }

    fun getItems(): List<CartLine> = lines.values.toList()

    fun getItemQuantity(menuItemId: Long): Int {
        return lines.values
            .filter { it.menuItem.id == menuItemId }
            .sumOf { it.quantity }
    }

    fun addItem(
        item: MenuItem,
        variationName: String? = null,
        quantity: Int = 1,
        notes: String? = null,
        customUnitPricePaise: Long? = null
    ) {
        val key = "${item.id}_${variationName ?: "default"}"
        val existing = lines[key]

        val unitPrice = customUnitPricePaise ?: if (!variationName.isNullOrBlank()) {
            item.variations.find { it.name.equals(variationName, ignoreCase = true) }?.pricePaise
                ?: item.displayPricePaise
        } else {
            item.displayPricePaise
        }

        if (existing != null) {
            existing.quantity += quantity
        } else {
            lines[key] = CartLine(
                menuItem = item,
                variationName = variationName,
                unitPricePaise = unitPrice,
                quantity = quantity,
                notes = notes
            )
        }

        persistAndSync()
    }

    fun hasItem(menuItemId: Long): Boolean {
        return lines.values.any { it.menuItem.id == menuItemId }
    }

    fun getLastLineForMenuItem(menuItemId: Long): CartLine? {
        return lines.values.lastOrNull { it.menuItem.id == menuItemId }
    }

    fun getLinesForMenuItem(menuItemId: Long): List<CartLine> {
        return lines.values.filter { it.menuItem.id == menuItemId }
    }

    fun updateQuantity(lineKey: String, newQuantity: Int) {
        if (newQuantity <= 0) {
            lines.remove(lineKey)
        } else {
            lines[lineKey]?.quantity = newQuantity
        }
        persistAndSync()
    }

    fun removeLine(lineKey: String) {
        lines.remove(lineKey)
        persistAndSync()
    }

    fun clear() {
        lines.clear()
        cacheManager?.clearCachedCart()
        notifyChanged()

        if (tokenManager?.isLoggedIn() == true) {
            scope.launch {
                apiClient?.clearRemoteCart()
            }
        }
    }

    private fun persistAndSync() {
        // Save to local storage immediately
        cacheManager?.saveCartLines(lines.values.toList())
        notifyChanged()

        // Sync with backend database if logged in
        scheduleRemoteSync()
    }

    private fun scheduleRemoteSync() {
        if (tokenManager?.isLoggedIn() != true) return
        syncJob?.cancel()
        syncJob = scope.launch {
            delay(350) // Debounce network sync
            val currentLines = lines.values.toList()
            apiClient?.syncRemoteCart(currentLines)
        }
    }

    fun syncFromRemote(onComplete: (() -> Unit)? = null) {
        if (tokenManager?.isLoggedIn() != true) return

        scope.launch {
            val result = apiClient?.getRemoteCart()
            if (result is NetworkResult.Success) {
                val remoteItems = result.data
                if (remoteItems.isNotEmpty()) {
                    val cachedMenu = cacheManager?.getCachedMenuItems { apiClient?.resolveImageUrl(it) }.orEmpty()

                    lines.clear()
                    for (remote in remoteItems) {
                        val menuItem = cachedMenu.find { it.id == remote.menuId }
                            ?: MenuItem(
                                id = remote.menuId,
                                name = "Kebab Item #${remote.menuId}",
                                pricePaise = remote.unitPricePaise,
                                isAvailable = true
                            )

                        val unitPrice = if (!remote.variationName.isNullOrBlank()) {
                            menuItem.variations.find { it.name.equals(remote.variationName, ignoreCase = true) }?.pricePaise
                                ?: if (remote.unitPricePaise > 0) remote.unitPricePaise else menuItem.displayPricePaise
                        } else {
                            if (remote.unitPricePaise > 0) remote.unitPricePaise else menuItem.displayPricePaise
                        }

                        val line = CartLine(
                            menuItem = menuItem,
                            variationName = remote.variationName,
                            unitPricePaise = unitPrice,
                            quantity = remote.quantity
                        )
                        lines[line.lineKey] = line
                    }

                    cacheManager?.saveCartLines(lines.values.toList())
                    withContext(Dispatchers.Main) {
                        notifyChanged()
                        onComplete?.invoke()
                    }
                } else if (lines.isNotEmpty()) {
                    // Local has items, push to remote so DB stays in sync
                    apiClient?.syncRemoteCart(lines.values.toList())
                }
            }
        }
    }

    fun refreshMenuItemDetails(freshItems: List<MenuItem>) {
        var updated = false
        val map = freshItems.associateBy { it.id }
        for ((key, line) in lines) {
            val fresh = map[line.menuItem.id]
            if (fresh != null) {
                val newPrice = if (!line.variationName.isNullOrBlank()) {
                    fresh.variations.find { it.name.equals(line.variationName, ignoreCase = true) }?.pricePaise
                        ?: fresh.displayPricePaise
                } else {
                    fresh.displayPricePaise
                }
                lines[key] = line.copy(
                    menuItem = fresh,
                    unitPricePaise = newPrice
                )
                updated = true
            }
        }
        if (updated) {
            cacheManager?.saveCartLines(lines.values.toList())
            notifyChanged()
        }
    }

    fun getTotalItemCount(): Int = lines.values.sumOf { it.quantity }

    fun getSubtotalPaise(): Long = lines.values.sumOf { it.lineTotalPaise }

    fun updateDeliveryEstimate(estimate: DeliveryEstimate?) {
        deliveryEstimate = estimate
        if (estimate == null) {
            deliveryFeePaise = 0L
            rawDeliveryFeePaise = 0L
            roundOffPaise = 0L
            isOutsideDeliveryZone = false
            isFreeDeliveryByThreshold = false
            return
        }

        isOutsideDeliveryZone = !estimate.withinRadius
        isFreeDeliveryByThreshold = estimate.isFreeByThreshold
        rawDeliveryFeePaise = if (estimate.isFreeByThreshold || !estimate.withinRadius) 0L else estimate.rawDeliveryFeePaise
        deliveryFeePaise = if (estimate.isFreeByThreshold || !estimate.withinRadius) 0L else estimate.deliveryFeePaise

        val subtotal = getSubtotalPaise()
        if (subtotal > 0L && estimate.withinRadius) {
            val rawPayable = subtotal + rawDeliveryFeePaise
            val roundedPayableInr = Math.round(rawPayable / 100.0)
            val payable = roundedPayableInr * 100
            roundOffPaise = payable - rawPayable
        } else {
            roundOffPaise = 0L
        }
    }

    fun getTotalPaise(): Long {
        val subtotal = getSubtotalPaise()
        if (subtotal == 0L) return 0L
        val fee = if (isOutsideDeliveryZone) 0L else rawDeliveryFeePaise
        val rawPayable = subtotal + fee
        val roundedPayableInr = Math.round(rawPayable / 100.0)
        return roundedPayableInr * 100
    }
}
