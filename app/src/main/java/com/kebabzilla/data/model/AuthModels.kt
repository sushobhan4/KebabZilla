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
    val promotionalConsent: Boolean = false
)

data class AuthResponse(
    val accessToken: String,
    val tokenType: String = "Bearer",
    val user: User
)

data class GoogleAuthRequest(
    val idToken: String
)
