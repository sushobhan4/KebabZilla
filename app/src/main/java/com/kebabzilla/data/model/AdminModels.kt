package com.kebabzilla.data.model

data class SalesChartPoint(
    val label: String,
    val revenuePaise: Long = 0L,
    val orders: Int = 0
)

data class SalesReport(
    val period: String = "today",
    val revenuePaise: Long = 0L,
    val paidOrders: Int = 0,
    val totalOrders: Int = 0,
    val averageOrderPaise: Long = 0L,
    val statuses: Map<String, Int> = emptyMap(),
    val topItems: List<TopItem> = emptyList(),
    val series: List<SalesChartPoint> = emptyList(),
    val cashOrders: Int = 0,
    val cashRevenuePaise: Long = 0L,
    val onlineOrders: Int = 0,
    val onlineRevenuePaise: Long = 0L,
    val deliveryOrders: Int = 0,
    val deliveryRevenuePaise: Long = 0L,
    val dineInOrders: Int = 0,
    val dineInRevenuePaise: Long = 0L
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

data class AdminAccountsSummary(
    val items: List<AdminAccount> = emptyList(),
    val total: Int = 0,
    val roleCounts: Map<String, Int> = emptyMap()
)

data class AdminEvent(
    val id: Long,
    val eventType: String,
    val description: String,
    val actorEmail: String? = null,
    val actorName: String? = null,
    val createdAt: String? = null
)

data class OfferLog(
    val id: Long,
    val subject: String,
    val message: String,
    val audience: String = "ALL",
    val channels: List<String> = listOf("EMAIL"),
    val recipientCount: Int = 0,
    val sentCount: Int = 0,
    val status: String = "QUEUED",
    val createdAt: String? = null
) {
    val title: String get() = subject
    val channel: String get() = channels.firstOrNull() ?: "EMAIL"
}

data class OfferCampaignInput(
    val audience: String = "ALL",
    val channels: List<String> = listOf("EMAIL"),
    val subject: String,
    val message: String,
    val headline: String? = null,
    val subheading: String? = null,
    val promoCode: String? = null,
    val discountHighlight: String? = null,
    val ctaText: String? = null,
    val ctaUrl: String? = null
)

data class DriverDutyStatus(
    val isAcceptingDeliveries: Boolean = false,
    val isRestaurantOpen: Boolean = true,
    val scheduleStatus: String? = null,
    val activeRiders: Int = 0,
    val restaurantLatitude: Double? = null,
    val restaurantLongitude: Double? = null
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
    val restaurantName: String = "KebabZilla",
    val tagline: String = "Smoky Kebabs & Rolls",
    val address: String = "Kolkata, India",
    val openTime: String? = "11:00",
    val closeTime: String? = "23:00",
    val phone: String? = "+91 9876543210",
    val deliveryRadiusKm: Double = 15.0,
    val freeDeliveryRadiusKm: Double = 2.0,
    val freeDeliveryThresholdPaise: Long = 29900L,
    val deliveryFeePerKmPaise: Long = 1500L,
    val minimumOrderPaise: Long = 0L,
    val orderCutoffMinutes: Int = 30,
    val availableDriversReady: Int = 0
)

data class AdminOrdersResponse(
    val orders: List<Order> = emptyList(),
    val total: Int = 0
)

data class AdminOrdersSummary(
    val items: List<Order> = emptyList(),
    val total: Int = 0,
    val statusCounts: Map<String, Int> = emptyMap()
)
