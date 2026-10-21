package com.kebabzilla.ui.menu

import com.kebabzilla.data.model.MenuCategory
import com.kebabzilla.data.model.MenuItem

sealed class MenuUiState {
    object Loading : MenuUiState()
    data class Success(
        val categories: List<MenuCategory>,
        val items: List<MenuItem>,
        val selectedCategory: String? = null
    ) : MenuUiState()
    data class Error(val message: String) : MenuUiState()
}
