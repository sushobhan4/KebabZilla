package com.kebabzilla.data.repository

import com.kebabzilla.data.api.NetworkResult
import com.kebabzilla.data.model.AuthResponse
import com.kebabzilla.data.model.LoginRequest
import com.kebabzilla.data.model.RegisterRequest
import com.kebabzilla.data.model.User

interface AuthRepository {
    suspend fun login(request: LoginRequest): NetworkResult<AuthResponse>
    suspend fun register(request: RegisterRequest): NetworkResult<AuthResponse>
    suspend fun getCurrentUser(): NetworkResult<User>
    suspend fun logout(): NetworkResult<Unit>
    fun isLoggedIn(): Boolean
}
