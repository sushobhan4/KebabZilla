package com.kebabzilla.utils

object Constants {
    // API Endpoints
    const val BASE_URL_PRODUCTION = "https://kebabzilla.in/api/v1/"
    const val BASE_URL_EMULATOR = "http://10.0.2.2:8000/api/v1/"
    const val DEFAULT_BASE_URL = BASE_URL_PRODUCTION

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
}
