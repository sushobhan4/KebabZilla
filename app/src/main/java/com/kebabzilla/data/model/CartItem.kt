package com.kebabzilla.data.model

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
    val items: List<CartItem> = emptyList(),
    val subtotalPaise: Long = 0,
    val deliveryFeePaise: Long = 0,
    val discountPaise: Long = 0,
    val totalPaise: Long = 0,
    val couponCode: String? = null
)
