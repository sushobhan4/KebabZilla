package com.kebabzilla.ui.cart

import com.kebabzilla.data.model.CartSummary

sealed class CartUiState {
    object Loading : CartUiState()
    data class Success(val cart: CartSummary) : CartUiState()
    data class Error(val message: String) : CartUiState()
}
