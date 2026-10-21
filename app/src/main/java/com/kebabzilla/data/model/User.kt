package com.kebabzilla.data.model

data class User(
    val id: Long,
    val email: String,
    val fullName: String,
    val phone: String? = null,
    val role: String = "USER",
    val isVerified: Boolean = false,
    val promotionalConsent: Boolean = false,
    val createdAt: String? = null
)

data class Address(
    val id: Long? = null,
    val label: String, // Home, Work, Other
    val street: String,
    val landmark: String? = null,
    val city: String = "Amtala",
    val postalCode: String? = null,
    val latitude: Double? = null,
    val longitude: Double? = null,
    val isDefault: Boolean = false
)
