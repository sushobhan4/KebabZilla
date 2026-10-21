package com.kebabzilla.ui.orders

import com.kebabzilla.data.model.Order

sealed class OrderUiState {
    object Loading : OrderUiState()
    data class Success(val orders: List<Order>) : OrderUiState()
    data class Error(val message: String) : OrderUiState()
}
