package com.kebabzilla.data.model

data class LoginRequest(
    val email: String,
    val password: String
)

data class RegisterRequest(
    val email: String,
    val password: String,
    val fullName: String,
    val phone: String? = null,
    val promotionalConsent: Boolean = true
)

data class AuthResponse(
    val accessToken: String? = null,
    val tokenType: String = "Bearer",
    val user: User? = null,
    val requires2Fa: Boolean = false,
    val tempToken: String? = null,
    val email: String? = null,
    val role: String? = null
)

data class GoogleAuthRequest(
    val idToken: String
)

data class UserSession(
    val id: String,
    val userAgent: String? = null,
    val ipAddress: String? = null,
    val deviceType: String? = "mobile",
    val isCurrent: Boolean = false,
    val lastActive: String? = null,
    val createdAt: String? = null
)
