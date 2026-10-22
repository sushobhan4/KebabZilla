package com.kebabzilla.data.model

data class SalesReport(
    val period: String = "today",
    val revenuePaise: Long = 0L,
    val paidOrders: Int = 0,
    val totalOrders: Int = 0,
    val averageOrderPaise: Long = 0L,
    val statuses: Map<String, Int> = emptyMap(),
    val topItems: List<TopItem> = emptyList(),
    val cashOrders: Int = 0,
    val cashRevenuePaise: Long = 0L,
    val onlineOrders: Int = 0,
    val onlineRevenuePaise: Long = 0L
)

data class TopItem(
    val name: String,
    val quantity: Int
)

data class AdminAccount(
    val id: Long,
    val name: String,
    val email: String,
    val phone: String? = null,
    val role: String = "STAFF",
    val createdAt: String? = null
)

data class AdminEvent(
    val id: Long,
    val eventType: String,
    val description: String,
    val actorEmail: String? = null,
    val createdAt: String? = null
)

data class OfferLog(
    val id: Long,
    val title: String,
    val message: String,
    val channel: String = "EMAIL",
    val recipientCount: Int = 0,
    val createdAt: String? = null
)

data class MenuDiscount(
    val id: Long,
    val code: String,
    val percentage: Double? = null,
    val flatAmountPaise: Long? = null,
    val minOrderPaise: Long = 0L,
    val isActive: Boolean = true
)

data class MenuPauseItem(
    val menuItemId: String,
    val employeeName: String = "Staff",
    val pausedUntil: String = ""
)

data class AdminRestaurantSettings(
    val isOpen: Boolean = true,
    val isDeliveryEnabled: Boolean = true,
    val openTime: String? = "11:00",
    val closeTime: String? = "23:00",
    val phone: String? = "+91 9876543210",
    val deliveryRadiusKm: Double = 15.0
)

data class AdminOrdersResponse(
    val orders: List<Order> = emptyList(),
    val total: Int = 0
)
