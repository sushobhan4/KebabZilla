package com.kebabzilla.data.model

import java.io.Serializable

data class User(
    val id: Long,
    val name: String,
    val email: String,
    val phone: String? = null,
    val role: String = "USER",
    val addresses: List<Address> = emptyList(),
    val promotionalConsent: Boolean = true
) : Serializable

data class Address(
    val id: String? = null,
    val label: String = "Home", // Home, Work, Other
    val houseNumber: String? = null,
    val road: String? = null,
    val area: String? = null,
    val city: String = "Amtala",
    val pincode: String? = null,
    val landmark: String? = null,
    val latitude: Double? = null,
    val longitude: Double? = null,
    val isDefault: Boolean = false
) : Serializable {
    val fullAddressText: String
        get() {
            val parts = listOfNotNull(houseNumber, road, area, landmark, city, pincode)
                .map { it.trim() }
                .filter { it.isNotBlank() }
            return if (parts.isNotEmpty()) parts.joinToString(", ") else label
        }

    val isConfigured: Boolean
        get() = !houseNumber.isNullOrBlank() || !road.isNullOrBlank() || latitude != null
}
