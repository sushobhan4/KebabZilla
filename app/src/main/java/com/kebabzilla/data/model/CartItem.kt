package com.kebabzilla.data.model

data class CartLine(
    val menuItem: MenuItem,
    val variationName: String? = null,
    val unitPricePaise: Long = menuItem.displayPricePaise,
    var quantity: Int = 1,
    var notes: String? = null
) {
    val lineKey: String
        get() = "${menuItem.id}_${variationName ?: "default"}"

    val lineTotalPaise: Long
        get() = unitPricePaise * quantity

    val displayName: String
        get() = if (!variationName.isNullOrBlank()) "${menuItem.name} ($variationName)" else menuItem.name
}

data class CartItem(
    val id: Long? = null,
    val menuItemId: Long,
    val name: String,
    val variationId: Long? = null,
    val variationName: String? = null,
    val unitPricePaise: Long,
    val quantity: Int,
    val instructions: String? = null
) {
    val totalPricePaise: Long
        get() = unitPricePaise * quantity
}

data class CartSummary(
    val items: List<CartLine> = emptyList(),
    val subtotalPaise: Long = 0,
    val deliveryFeePaise: Long = 0L,
    val roundOffPaise: Long = 0L,
    val discountPaise: Long = 0,
    val totalPaise: Long = 0,
    val couponCode: String? = null
)

data class DeliveryEstimate(
    val distanceKm: Double,
    val method: String = "HAVERSINE",
    val deliveryFeePaise: Long,
    val deliveryFeeInr: Double,
    val rawDeliveryFeePaise: Long = deliveryFeePaise,
    val rawDeliveryFeeInr: Double = deliveryFeeInr,
    val roundOffPaise: Long = 0L,
    val withinRadius: Boolean = true,
    val maxRadiusKm: Double = 10.0,
    val freeRadiusKm: Double = 3.0,
    val freeDeliveryThresholdPaise: Long = 0L,
    val feePerKmPaise: Long = 0L,
    val isFreeByThreshold: Boolean = false
)

data class RemoteCartItem(
    val id: Long? = null,
    val menuId: Long,
    val variationName: String? = null,
    val quantity: Int = 1,
    val unitPricePaise: Long = 0L
)
