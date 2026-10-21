package com.kebabzilla.data.repository

import com.kebabzilla.data.api.NetworkResult
import com.kebabzilla.data.model.MenuCategory
import com.kebabzilla.data.model.MenuItem

interface MenuRepository {
    suspend fun getCategories(): NetworkResult<List<MenuCategory>>
    suspend fun getMenuItems(category: String? = null): NetworkResult<List<MenuItem>>
    suspend fun getMenuItemById(itemId: Long): NetworkResult<MenuItem>
}
