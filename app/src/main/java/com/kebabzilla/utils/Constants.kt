package com.kebabzilla.utils

import com.kebabzilla.BuildConfig

object Constants {
    // API Endpoints - strictly production API
    const val BASE_URL_PRODUCTION = "https://api.kebabzilla.in/api/v1/"
    const val BASE_URL_EMULATOR = "http://10.0.2.2:8000/api/v1/"
    const val DEFAULT_BASE_URL = BASE_URL_PRODUCTION

    // Google OAuth Client IDs (injected via secret.properties & BuildConfig)
    val GOOGLE_SERVER_CLIENT_ID: String = BuildConfig.GOOGLE_SERVER_CLIENT_ID
    val GOOGLE_CLIENT_ID: String = GOOGLE_SERVER_CLIENT_ID
    val GOOGLE_ANDROID_CLIENT_ID: String = BuildConfig.GOOGLE_ANDROID_CLIENT_ID

    // Google Maps API Key (injected via secret.properties & BuildConfig)
    val GOOGLE_MAPS_API_KEY: String = BuildConfig.GOOGLE_MAPS_API_KEY

    // Restaurant Geo Coordinates & Logistics
    const val RESTAURANT_LATITUDE = 22.365278
    const val RESTAURANT_LONGITUDE = 88.269444
    const val DEFAULT_DELIVERY_RADIUS_KM = 15.0

    // User Roles
    const val ROLE_USER = "USER"
    const val ROLE_STAFF = "STAFF"
    const val ROLE_RIDER = "RIDER"
    const val ROLE_ADMIN = "ADMIN"

    // Order Statuses
    const val STATUS_PLACED = "PLACED"
    const val STATUS_PREPARING = "PREPARING"
    const val STATUS_READY = "READY"
    const val STATUS_OUT_FOR_DELIVERY = "OUT_FOR_DELIVERY"
    const val STATUS_DELIVERED = "DELIVERED"
    const val STATUS_CANCELLED = "CANCELLED"

    // Payment Methods
    const val PAYMENT_RAZORPAY = "RAZORPAY"
    const val PAYMENT_COD = "COD"

    // SharedPreferences Keys
    const val PREFS_NAME = "kebabzilla_prefs"
    const val KEY_ACCESS_TOKEN = "access_token"
    const val KEY_CSRF_TOKEN = "csrf_token"
    const val KEY_USER_ROLE = "user_role"
    const val KEY_USER_EMAIL = "user_email"
    const val KEY_USER_NAME = "user_name"
    const val KEY_USER_PHONE = "user_phone"
    const val KEY_USER_ID = "user_id"
    const val KEY_USER_ADDRESSES = "user_addresses"
    const val KEY_USER_PROMO_CONSENT = "user_promo_consent"
    const val KEY_PROFILE_LAST_SYNCED = "profile_last_synced"

    // Local Data & State Cache Keys (Offline-First / Zero Latency)
    const val KEY_CACHED_RESTAURANT_INFO = "cached_restaurant_info"
    const val KEY_CACHED_RESTAURANT_HEADING = "cached_restaurant_heading"
    const val KEY_CACHED_RESTAURANT_MESSAGE = "cached_restaurant_message"
    const val KEY_CACHED_RESTAURANT_IS_OPEN = "cached_restaurant_is_open"
    const val KEY_CACHED_RESTAURANT_IS_DELIVERY = "cached_restaurant_is_delivery"
    const val KEY_CACHED_MENU_JSON = "cached_menu_json"
    const val KEY_CACHED_CUSTOM_MENU_JSON = "cached_custom_menu_json"
    const val KEY_CACHED_ACTIVE_CART = "cached_active_cart"
}
