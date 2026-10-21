package com.kebabzilla.data.model

data class Order(
    val id: Long,
    val customerId: Long,
    val customerName: String? = null,
    val customerEmail: String? = null,
    val customerPhone: String? = null,
    val items: List<OrderItem> = emptyList(),
    val status: String, // PLACED, PREPARING, READY, OUT_FOR_DELIVERY, DELIVERED, CANCELLED
    val totalAmountPaise: Long,
    val deliveryFeePaise: Long = 0,
    val paymentMethod: String = "RAZORPAY", // RAZORPAY, COD
    val paymentStatus: String = "PENDING", // PENDING, PAID, REFUNDED
    val deliveryAddress: String? = null,
    val deliveryOtp: String? = null,
    val riderId: Long? = null,
    val riderName: String? = null,
    val createdAt: String? = null,
    val estimatedDeliveryMinutes: Int? = null
)

data class OrderItem(
    val id: Long,
    val menuItemId: Long,
    val itemName: String,
    val variationName: String? = null,
    val quantity: Int,
    val unitPricePaise: Long
)
