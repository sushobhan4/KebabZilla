package com.kebabzilla.data.local

import android.content.Context
import android.content.SharedPreferences
import com.kebabzilla.data.model.CartLine
import com.kebabzilla.data.model.CustomMenuOption
import com.kebabzilla.data.model.CustomMenuSection
import com.kebabzilla.data.model.MenuItem
import com.kebabzilla.data.model.MenuVariation
import com.kebabzilla.data.model.RestaurantInfo
import com.kebabzilla.utils.Constants
import org.json.JSONArray
import org.json.JSONObject

class DataCacheManager(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences(Constants.PREFS_NAME, Context.MODE_PRIVATE)

    // --- Restaurant State Cache ---

    fun saveRestaurantState(
        info: RestaurantInfo,
        rawJson: String,
        heading: String?,
        message: String?
    ) {
        prefs.edit()
            .putString(Constants.KEY_CACHED_RESTAURANT_INFO, rawJson)
            .putBoolean(Constants.KEY_CACHED_RESTAURANT_IS_OPEN, info.isRestaurantOpen)
            .putBoolean(Constants.KEY_CACHED_RESTAURANT_IS_DELIVERY, info.isDeliveryOpen)
            .putString(Constants.KEY_CACHED_RESTAURANT_HEADING, heading ?: info.deliveryStatusHeading ?: "")
            .putString(Constants.KEY_CACHED_RESTAURANT_MESSAGE, message ?: info.deliveryStatusMessage ?: "")
            .apply()
    }

    fun getCachedRestaurantStatusText(): Pair<String, String>? {
        val heading = prefs.getString(Constants.KEY_CACHED_RESTAURANT_HEADING, null)
        val message = prefs.getString(Constants.KEY_CACHED_RESTAURANT_MESSAGE, null)
        return if (!heading.isNullOrBlank() || !message.isNullOrBlank()) {
            Pair(heading.orEmpty(), message.orEmpty())
        } else {
            null
        }
    }

    fun getCachedRestaurantIsOpen(): Boolean {
        return prefs.getBoolean(Constants.KEY_CACHED_RESTAURANT_IS_OPEN, true)
    }

    fun getCachedRestaurantIsDeliveryOpen(): Boolean {
        return prefs.getBoolean(Constants.KEY_CACHED_RESTAURANT_IS_DELIVERY, true)
    }

    fun getCachedRestaurantInfo(): RestaurantInfo? {
        val raw = prefs.getString(Constants.KEY_CACHED_RESTAURANT_INFO, null) ?: return null
        return try {
            val json = JSONObject(raw)
            val customReason = json.optString("delivery_paused_reason").takeIf { it.isNotBlank() }
                ?: json.optString("delivery_status_heading").takeIf { it.isNotBlank() }
            RestaurantInfo(
                name = json.optString("restaurant_name", "KebabZilla"),
                tagline = json.optString("tagline", "Authentic Kebabs & Fast Casual Dining"),
                phone = json.optString("phone").takeIf { it.isNotBlank() },
                email = json.optString("email", "support@kebabzilla.in"),
                address = json.optString("address", "Amtala, DH Road, South 24 Parganas"),
                latitude = if (json.has("latitude") && !json.isNull("latitude")) json.optDouble("latitude") else Constants.RESTAURANT_LATITUDE,
                longitude = if (json.has("longitude") && !json.isNull("longitude")) json.optDouble("longitude") else Constants.RESTAURANT_LONGITUDE,
                isRestaurantOpen = json.optBoolean("is_restaurant_open", true),
                isDeliveryOpen = json.optBoolean("is_delivery_open", true),
                deliveryRadiusKm = json.optDouble("delivery_radius_km", 10.0),
                freeDeliveryRadiusKm = json.optDouble("free_delivery_radius_km", 3.0),
                freeDeliveryThresholdPaise = json.optLong("free_delivery_threshold_paise", 0L),
                deliveryFeePerKmPaise = json.optLong("delivery_fee_per_km_paise", 0L),
                chargeFromZeroBeyondFreeRadius = json.optBoolean("charge_from_zero_beyond_free_radius", false),
                deliveryStatusHeading = customReason,
                deliveryStatusMessage = json.optString("delivery_status_message").takeIf { it.isNotBlank() },
                closingInMinutes = if (json.has("closing_in_minutes") && !json.isNull("closing_in_minutes")) json.optInt("closing_in_minutes") else null,
                cutoffInMinutes = if (json.has("cutoff_in_minutes") && !json.isNull("cutoff_in_minutes")) json.optInt("cutoff_in_minutes") else null,
                closingTime = json.optString("closing_time").takeIf { it.isNotBlank() }
            )
        } catch (_: Exception) {
            null
        }
    }

    // --- Menu Items Cache ---

    fun saveMenuItemsRaw(rawJson: String) {
        prefs.edit()
            .putString(Constants.KEY_CACHED_MENU_JSON, rawJson)
            .apply()
    }

    fun getCachedMenuRaw(): String? {
        return prefs.getString(Constants.KEY_CACHED_MENU_JSON, null)
    }

    fun saveCustomMenuItemsRaw(rawJson: String) {
        prefs.edit()
            .putString(Constants.KEY_CACHED_CUSTOM_MENU_JSON, rawJson)
            .apply()
    }

    fun getCachedCustomMenuRaw(): String? {
        return prefs.getString(Constants.KEY_CACHED_CUSTOM_MENU_JSON, null)
    }

    fun getCachedMenuItems(imageUrlResolver: (String?) -> String?): List<MenuItem>? {
        val standardRaw = getCachedMenuRaw()
        val customRaw = getCachedCustomMenuRaw()
        if (standardRaw == null && customRaw == null) return null

        val combined = mutableListOf<MenuItem>()
        val seenIds = mutableSetOf<Long>()

        if (!standardRaw.isNullOrBlank()) {
            val std = parseMenuItemsJson(standardRaw, imageUrlResolver)
            std.forEach {
                if (seenIds.add(it.id)) combined.add(it)
            }
        }
        if (!customRaw.isNullOrBlank()) {
            val custom = parseCustomMenuItemsJson(customRaw, imageUrlResolver)
            custom.forEach {
                if (seenIds.add(it.id)) combined.add(it)
            }
        }
        return combined
    }

    // --- Active Cart Persistence ---

    fun saveCartLines(lines: List<CartLine>) {
        try {
            val array = JSONArray()
            for (line in lines) {
                val obj = JSONObject().apply {
                    put("menu_id", line.menuItem.id)
                    put("menu_name", line.menuItem.name)
                    put("menu_description", line.menuItem.description ?: "")
                    put("menu_category", line.menuItem.category)
                    val catsArr = JSONArray()
                    line.menuItem.categories.forEach { catsArr.put(it) }
                    put("menu_categories", catsArr)
                    put("menu_price_paise", line.menuItem.pricePaise)
                    put("menu_discount_percent", line.menuItem.discountPercent)
                    if (line.menuItem.discountedPricePaise != null) {
                        put("menu_discounted_price_paise", line.menuItem.discountedPricePaise)
                    }
                    put("menu_image_url", line.menuItem.imageUrl ?: "")
                    put("menu_is_vegetarian", line.menuItem.isVegetarian)
                    put("menu_is_available", line.menuItem.isAvailable)
                    put("menu_is_paused", line.menuItem.isPaused)

                    val varsArray = JSONArray()
                    for (v in line.menuItem.variations) {
                        val vObj = JSONObject().apply {
                            put("name", v.name)
                            put("price_paise", v.pricePaise)
                            put("is_default", v.isDefault)
                        }
                        varsArray.put(vObj)
                    }
                    put("menu_variations", varsArray)

                    put("variation_name", line.variationName ?: "")
                    put("unit_price_paise", line.unitPricePaise)
                    put("quantity", line.quantity)
                    put("notes", line.notes ?: "")
                }
                array.put(obj)
            }
            prefs.edit().putString(Constants.KEY_CACHED_ACTIVE_CART, array.toString()).apply()
        } catch (_: Exception) {}
    }

    fun getCachedCartLines(): List<CartLine> {
        val raw = prefs.getString(Constants.KEY_CACHED_ACTIVE_CART, null) ?: return emptyList()
        return try {
            val array = JSONArray(raw)
            val list = mutableListOf<CartLine>()
            for (i in 0 until array.length()) {
                val obj = array.getJSONObject(i)
                val cats = mutableListOf<String>()
                val catsArr = obj.optJSONArray("menu_categories")
                if (catsArr != null) {
                    for (c in 0 until catsArr.length()) {
                        cats.add(catsArr.getString(c))
                    }
                }

                val vars = mutableListOf<MenuVariation>()
                val varsArr = obj.optJSONArray("menu_variations")
                if (varsArr != null) {
                    for (v in 0 until varsArr.length()) {
                        val vObj = varsArr.getJSONObject(v)
                        vars.add(
                            MenuVariation(
                                name = vObj.optString("name", "Standard"),
                                pricePaise = vObj.optLong("price_paise", 0L),
                                isDefault = vObj.optBoolean("is_default", false)
                            )
                        )
                    }
                }

                val item = MenuItem(
                    id = obj.optLong("menu_id"),
                    name = obj.optString("menu_name", "Kebab Item"),
                    description = obj.optString("menu_description").takeIf { it.isNotBlank() },
                    category = obj.optString("menu_category", "All"),
                    categories = cats,
                    pricePaise = obj.optLong("menu_price_paise", 0L),
                    discountPercent = obj.optInt("menu_discount_percent", 0),
                    discountedPricePaise = if (obj.has("menu_discounted_price_paise") && !obj.isNull("menu_discounted_price_paise")) obj.optLong("menu_discounted_price_paise") else null,
                    imageUrl = obj.optString("menu_image_url").takeIf { it.isNotBlank() },
                    isVegetarian = obj.optBoolean("menu_is_vegetarian", false),
                    isAvailable = obj.optBoolean("menu_is_available", true),
                    isPaused = obj.optBoolean("menu_is_paused", false),
                    variations = vars
                )

                list.add(
                    CartLine(
                        menuItem = item,
                        variationName = obj.optString("variation_name").takeIf { it.isNotBlank() },
                        unitPricePaise = obj.optLong("unit_price_paise", item.displayPricePaise),
                        quantity = obj.optInt("quantity", 1),
                        notes = obj.optString("notes").takeIf { it.isNotBlank() }
                    )
                )
            }
            list
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun clearCachedCart() {
        prefs.edit().remove(Constants.KEY_CACHED_ACTIVE_CART).apply()
    }

    companion object {
        fun parseMenuItemsJson(
            rawJson: String,
            imageUrlResolver: (String?) -> String?
        ): List<MenuItem> {
            val array = JSONArray(rawJson)
            val list = mutableListOf<MenuItem>()
            for (i in 0 until array.length()) {
                val itemObj = array.getJSONObject(i)

                val variationsList = mutableListOf<MenuVariation>()
                val parsedSections = mutableListOf<CustomMenuSection>()
                val varsArray = itemObj.optJSONArray("variations")
                if (varsArray != null) {
                    for (v in 0 until varsArray.length()) {
                        val vObj = varsArray.getJSONObject(v)
                        variationsList.add(
                            MenuVariation(
                                name = vObj.optString("name", "Standard"),
                                pricePaise = vObj.optLong("price_paise", 0L),
                                isDefault = vObj.optBoolean("is_default", false)
                            )
                        )
                    }
                }

                val categoriesList = mutableListOf<String>()
                val catsArray = itemObj.optJSONArray("categories")
                if (catsArray != null) {
                    for (c in 0 until catsArray.length()) {
                        categoriesList.add(catsArray.getString(c))
                    }
                }

                val rawImageUrl = itemObj.optString("image_url").takeIf { it.isNotBlank() }

                list.add(
                    MenuItem(
                        id = itemObj.optLong("id"),
                        name = itemObj.optString("name"),
                        description = itemObj.optString("description").takeIf { it.isNotBlank() && !it.equals("null", ignoreCase = true) },
                        category = itemObj.optString("category", "All"),
                        categories = categoriesList,
                        pricePaise = itemObj.optLong("price_paise", 0L),
                        basePricePaise = itemObj.optLong("base_price_paise", itemObj.optLong("price_paise", 0L)),
                        discountPercent = itemObj.optInt("discount_percent", 0),
                        discountedPricePaise = if (itemObj.has("discounted_price_paise") && !itemObj.isNull("discounted_price_paise")) itemObj.optLong("discounted_price_paise") else null,
                        discountCampaignName = itemObj.optString("discount_campaign_name").takeIf { it.isNotBlank() && !it.equals("null", ignoreCase = true) },
                        isFeatured = itemObj.optBoolean("is_featured", false),
                        imageUrl = imageUrlResolver(rawImageUrl),
                        isVegetarian = itemObj.optBoolean("is_vegetarian", false),
                        isAvailable = itemObj.optBoolean("is_available", true),
                        isPaused = itemObj.optBoolean("is_paused", false),
                        variations = variationsList
                    )
                )
            }
            return list
        }

        fun parseCustomMenuItemsJson(
            rawJson: String,
            imageUrlResolver: (String?) -> String?
        ): List<MenuItem> {
            val array = JSONArray(rawJson)
            val list = mutableListOf<MenuItem>()
            for (i in 0 until array.length()) {
                val itemObj = array.getJSONObject(i)
                val catsList = mutableListOf<String>()
                val catsArray = itemObj.optJSONArray("categories")
                if (catsArray != null) {
                    for (c in 0 until catsArray.length()) {
                        catsList.add(catsArray.getString(c))
                    }
                }
                val primaryCategory = if (catsList.isNotEmpty()) {
                    catsList[0]
                } else {
                    itemObj.optString("category").takeIf { it.isNotBlank() } ?: "Specialty Rolls"
                }
                if (catsList.isEmpty()) {
                    catsList.add(primaryCategory)
                }

                var rawImageUrl = itemObj.optString("image_url").takeIf { it.isNotBlank() }
                if (rawImageUrl == null) {
                    val imgUrls = itemObj.optJSONArray("image_urls")
                    if (imgUrls != null && imgUrls.length() > 0) {
                        rawImageUrl = imgUrls.optString(0).takeIf { it.isNotBlank() }
                    }
                }

                val basePrice = if (itemObj.has("base_price_paise")) {
                    itemObj.optLong("base_price_paise", 0L)
                } else {
                    itemObj.optLong("price_paise", 0L)
                }
                val lowestPrice = if (itemObj.has("lowest_price_paise") && itemObj.optLong("lowest_price_paise") > 0) {
                    itemObj.optLong("lowest_price_paise")
                } else {
                    basePrice
                }

                val discPercent = itemObj.optInt("discount_percent", 0)
                val discPrice = if (itemObj.has("discounted_base_price_paise") && !itemObj.isNull("discounted_base_price_paise")) {
                    itemObj.optLong("discounted_base_price_paise")
                } else if (itemObj.has("discounted_price_paise") && !itemObj.isNull("discounted_price_paise")) {
                    itemObj.optLong("discounted_price_paise")
                } else if (discPercent > 0) {
                    (lowestPrice * (100 - discPercent)) / 100
                } else null

                val variationsList = mutableListOf<MenuVariation>()
                val parsedSections = mutableListOf<CustomMenuSection>()
                val varsArray = itemObj.optJSONArray("variations")
                if (varsArray != null && varsArray.length() > 0) {
                    for (v in 0 until varsArray.length()) {
                        val vObj = varsArray.getJSONObject(v)
                        variationsList.add(
                            MenuVariation(
                                name = vObj.optString("name", "Standard"),
                                pricePaise = vObj.optLong("price_paise", lowestPrice),
                                isDefault = vObj.optBoolean("is_default", false)
                            )
                        )
                    }
                } else {
                    val sectionsArray = itemObj.optJSONArray("sections")
                    if (sectionsArray != null && sectionsArray.length() > 0) {
                        for (s in 0 until sectionsArray.length()) {
                            val secObj = sectionsArray.getJSONObject(s)
                            val secName = secObj.optString("name")
                            val isRequired = secObj.optBoolean("required", true)
                            val optsArray = secObj.optJSONArray("options")
                            val secOptions = mutableListOf<CustomMenuOption>()
                            if (optsArray != null) {
                                for (o in 0 until optsArray.length()) {
                                    val optObj = optsArray.getJSONObject(o)
                                    val optName = optObj.optString("name")
                                    val extra = if (optObj.has("extra_paise")) optObj.optLong("extra_paise", 0L) else optObj.optLong("price_paise", 0L)
                                    secOptions.add(CustomMenuOption(name = optName, extraPaise = extra, isDefault = (o == 0)))
                                    val optPrice = basePrice + extra
                                    val label = if (sectionsArray.length() > 1 && secName.isNotBlank()) "$secName: $optName" else optName
                                    variationsList.add(
                                        MenuVariation(
                                            name = label,
                                            pricePaise = optPrice,
                                            isDefault = (o == 0 && s == 0)
                                        )
                                    )
                                }
                            }
                            parsedSections.add(CustomMenuSection(name = secName, required = isRequired, options = secOptions))
                        }
                    }
                }

                list.add(
                    MenuItem(
                        id = itemObj.optLong("id"),
                        name = itemObj.optString("name"),
                        description = itemObj.optString("description").takeIf { it.isNotBlank() && !it.equals("null", ignoreCase = true) },
                        category = primaryCategory,
                        categories = catsList,
                        pricePaise = lowestPrice,
                        basePricePaise = basePrice,
                        discountPercent = discPercent,
                        discountedPricePaise = discPrice,
                        discountCampaignName = itemObj.optString("discount_campaign_name").takeIf { it.isNotBlank() && !it.equals("null", ignoreCase = true) },
                        isFeatured = itemObj.optBoolean("is_featured", false),
                        imageUrl = imageUrlResolver(rawImageUrl),
                        isVegetarian = itemObj.optBoolean("is_vegetarian", false),
                        isAvailable = itemObj.optBoolean("is_available", true),
                        isPaused = itemObj.optBoolean("is_paused", false),
                        variations = emptyList(),
                        isCustomizable = true,
                        customSections = parsedSections
                    )
                )
            }
            return list
        }
    }
}
