package com.kebabzilla.data.repository

import com.kebabzilla.data.api.NetworkResult
import com.kebabzilla.data.model.CartItem
import com.kebabzilla.data.model.CartSummary

interface CartRepository {
    suspend fun getCart(): NetworkResult<CartSummary>
    suspend fun addItem(item: CartItem): NetworkResult<CartSummary>
    suspend fun updateQuantity(cartItemId: Long, quantity: Int): NetworkResult<CartSummary>
    suspend fun removeItem(cartItemId: Long): NetworkResult<CartSummary>
    suspend fun clearCart(): NetworkResult<Unit>
    suspend fun applyCoupon(code: String): NetworkResult<CartSummary>
}
