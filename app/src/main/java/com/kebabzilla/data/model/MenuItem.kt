package com.kebabzilla.data.model

data class MenuItem(
    val id: Long,
    val name: String,
    val description: String? = null,
    val category: String = "All",
    val categories: List<String> = emptyList(),
    val pricePaise: Long,
    val basePricePaise: Long = pricePaise,
    val discountPercent: Int = 0,
    val discountedPricePaise: Long? = null,
    val discountCampaignName: String? = null,
    val isFeatured: Boolean = false,
    val imageUrl: String? = null,
    val isVegetarian: Boolean = false,
    val isAvailable: Boolean = true,
    val isPaused: Boolean = false,
    val variations: List<MenuVariation> = emptyList(),
    val isCustomizable: Boolean = false,
    val customSections: List<CustomMenuSection> = emptyList()
) {
    val displayPricePaise: Long
        get() = discountedPricePaise ?: pricePaise

    val hasVariations: Boolean
        get() = variations.isNotEmpty()

    val isPortionOrSize: Boolean
        get() {
            if (variations.isEmpty()) return false

            // Explicit version / preparation / style / with-or-without keywords mean it's an option/version, not a portion/size
            val nonSizeKeywords = setOf(
                "with", "without", "w/", "w/o", "bone", "boneless", "gravy", "dry",
                "tikka", "reshmi", "malai", "haryali", "masala", "salted", "cheesy",
                "peri", "spicy", "mint", "mayo", "wheat", "maida", "rumali", "flavor", "flavour",
                "egg", "paneer", "chicken", "mutton", "sauce", "dip"
            )
            val hasExplicitNonSize = variations.any { v ->
                val words = v.name.lowercase().split(Regex("[^a-zA-Z0-9]+")).filter { it.isNotBlank() }
                words.any { it in nonSizeKeywords }
            }
            if (hasExplicitNonSize) return false

            // Size keywords or unit/count patterns
            val sizePattern = Regex("""(?i)\b(half|full|quarter|regular|large|medium|small|mini|jumbo|single|double|plate|portion)\b|\b\d+\s*(pc|pcs|piece|pieces|gm|gms|g|kg|ml|l|ltr|liter|litre)\b""")
            return variations.any { v ->
                sizePattern.containsMatchIn(v.name.trim())
            }
        }

    val variationEyebrow: String
        get() = if (isPortionOrSize) "PORTION" else "OPTION"

    val variationNoun: String
        get() = if (isPortionOrSize) "portion" else "option"

    val variationActionText: String
        get() = if (isPortionOrSize) "Choose size" else "Choose"
}

data class CustomMenuSection(
    val name: String,
    val required: Boolean = true,
    val options: List<CustomMenuOption> = emptyList()
)

data class CustomMenuOption(
    val name: String,
    val extraPaise: Long = 0L,
    val isDefault: Boolean = false
)

data class MenuVariation(
    val name: String,
    val pricePaise: Long,
    val isDefault: Boolean = false
)

data class MenuCategory(
    val id: String,
    val name: String,
    val iconName: String? = null,
    val displayOrder: Int = 0
)

data class RestaurantInfo(
    val name: String = "KebabZilla",
    val tagline: String = "Authentic Kebabs & Fast Casual Dining",
    val phone: String? = null,
    val email: String? = "support@kebabzilla.in",
    val address: String? = "Amtala, DH Road, South 24 Parganas, West Bengal",
    val latitude: Double? = 22.365278,
    val longitude: Double? = 88.269444,
    val isRestaurantOpen: Boolean = true,
    val isDeliveryOpen: Boolean = true,
    val deliveryRadiusKm: Double = 10.0,
    val freeDeliveryRadiusKm: Double = 3.0,
    val freeDeliveryThresholdPaise: Long = 0L,
    val deliveryFeePerKmPaise: Long = 0L,
    val chargeFromZeroBeyondFreeRadius: Boolean = false,
    val deliveryStatusHeading: String? = null,
    val deliveryStatusMessage: String? = null,
    val closingInMinutes: Int? = null,
    val cutoffInMinutes: Int? = null,
    val closingTime: String? = null
)
