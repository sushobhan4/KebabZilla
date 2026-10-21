package com.kebabzilla.data.model

data class MenuItem(
    val id: Long,
    val name: String,
    val description: String? = null,
    val pricePaise: Long,
    val category: String,
    val imageUrl: String? = null,
    val isAvailable: Boolean = true,
    val isVeg: Boolean = false,
    val spicyLevel: Int = 1,
    val variations: List<MenuVariation> = emptyList(),
    val pausedUntil: String? = null
)

data class MenuVariation(
    val id: Long,
    val name: String, // e.g. "4 Pieces", "8 Pieces", "Full Plate"
    val pricePaise: Long,
    val isDefault: Boolean = false
)

data class MenuCategory(
    val id: String,
    val name: String,
    val iconName: String? = null,
    val displayOrder: Int = 0
)
