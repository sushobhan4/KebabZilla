package com.kebabzilla.data.model

data class Order(
    val orderId: String,
    val customerName: String? = null,
    val customerPhone: String? = null,
    val status: String, // PLACED, PREPARING, READY, OUT_FOR_DELIVERY, DELIVERED, CANCELLED
    val paymentMethod: String? = "RAZORPAY", // RAZORPAY, CASH
    val paymentStatus: String? = "PENDING", // PENDING, PAID, FAILED
    val subtotalPaise: Long = 0,
    val deliveryFeePaise: Long = 0,
    val totalPaise: Long = 0,
    val address: String? = null,
    val notes: String? = null,
    val deliveryOtp: String? = null,
    val createdAt: String? = null,
    val items: List<OrderItem> = emptyList()
) {
    val isActive: Boolean
        get() = status in listOf("PLACED", "PREPARING", "READY", "OUT_FOR_DELIVERY")
}

data class OrderItem(
    val id: Long = 0,
    val menuItemId: Long = 0,
    val name: String,
    val variationName: String? = null,
    val quantity: Int = 1,
    val unitPricePaise: Long = 0,
    val lineTotalPaise: Long = 0,
    val imageUrl: String? = null
)
