package com.kebabzilla.ui.profile

import com.kebabzilla.data.model.Address
import com.kebabzilla.data.model.User

sealed class ProfileUiState {
    object Loading : ProfileUiState()
    data class Success(
        val user: User,
        val savedAddresses: List<Address> = emptyList()
    ) : ProfileUiState()
    data class Error(val message: String) : ProfileUiState()
}
