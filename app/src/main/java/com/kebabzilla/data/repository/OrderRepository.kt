package com.kebabzilla.data.repository

import com.kebabzilla.data.api.NetworkResult
import com.kebabzilla.data.model.Order

interface OrderRepository {
    suspend fun getOrders(): NetworkResult<List<Order>>
    suspend fun getOrderById(orderId: Long): NetworkResult<Order>
    suspend fun createOrder(cartId: Long?, paymentMethod: String, addressId: Long?): NetworkResult<Order>
    suspend fun cancelOrder(orderId: Long, reason: String?): NetworkResult<Unit>
}
