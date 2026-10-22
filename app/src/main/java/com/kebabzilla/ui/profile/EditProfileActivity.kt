package com.kebabzilla.ui.profile

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.lifecycleScope
import com.kebabzilla.data.api.ApiClient
import com.kebabzilla.data.api.NetworkResult
import com.kebabzilla.data.local.TokenManager
import com.kebabzilla.data.model.User
import com.kebabzilla.databinding.ActivityEditProfileBinding
import com.kebabzilla.ui.auth.AuthActivity
import kotlinx.coroutines.launch

class EditProfileActivity : AppCompatActivity() {

    private lateinit var binding: ActivityEditProfileBinding
    private lateinit var apiClient: ApiClient
    private lateinit var tokenManager: TokenManager
    private var currentUser: User? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        binding = ActivityEditProfileBinding.inflate(layoutInflater)
        setContentView(binding.root)

        ViewCompat.setOnApplyWindowInsetsListener(binding.root) { _, insets ->
            val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            binding.layoutTopBar.setPadding(0, systemBars.top, 0, 0)
            binding.layoutScrollContent.setPadding(
                binding.layoutScrollContent.paddingStart,
                binding.layoutScrollContent.paddingTop,
                binding.layoutScrollContent.paddingEnd,
                systemBars.bottom + 24
            )
            insets
        }

        tokenManager = TokenManager(this)
        if (!tokenManager.isLoggedIn()) {
            Toast.makeText(this, "Please sign in to edit your profile", Toast.LENGTH_SHORT).show()
            startActivity(Intent(this, AuthActivity::class.java))
            finish()
            return
        }

        apiClient = ApiClient(this)
        setupListeners()
        loadUserProfile()
    }

    private fun setupListeners() {
        binding.btnBack.setOnClickListener {
            finish()
        }

        binding.btnSavePersonalDetails.setOnClickListener {
            savePersonalDetails()
        }

        binding.btnUpdatePassword.setOnClickListener {
            updatePassword()
        }
    }

    private fun loadUserProfile() {
        // 1. Immediately pre-fill personal details from local cache
        val cached = tokenManager.getUserProfile()
        if (cached != null) {
            currentUser = cached
            binding.etEditName.setText(cached.name)
            binding.etEditEmail.setText(cached.email)
            val digits = cached.phone?.filter { it.isDigit() }?.takeLast(10).orEmpty()
            binding.etEditPhone.setText(digits)
        }

        // 2. Sync latest data in background
        lifecycleScope.launch {
            val result = apiClient.getMyProfile()
            when (result) {
                is NetworkResult.Success -> {
                    val user = result.data
                    currentUser = user
                    binding.etEditName.setText(user.name)
                    binding.etEditEmail.setText(user.email)
                    val digits = user.phone?.filter { it.isDigit() }?.takeLast(10).orEmpty()
                    binding.etEditPhone.setText(digits)
                }
                is NetworkResult.Error -> {
                    if (result.statusCode == 401) {
                        tokenManager.clearSession()
                        Toast.makeText(this@EditProfileActivity, "Your session has expired. Please sign in again.", Toast.LENGTH_LONG).show()
                        startActivity(Intent(this@EditProfileActivity, AuthActivity::class.java))
                        finish()
                    } else if (cached == null) {
                        Toast.makeText(this@EditProfileActivity, result.message, Toast.LENGTH_SHORT).show()
                    }
                }
                is NetworkResult.Loading -> {}
            }
        }
    }

    private fun savePersonalDetails() {
        val user = currentUser ?: return
        val name = binding.etEditName.text?.toString()?.trim().orEmpty()
        val email = binding.etEditEmail.text?.toString()?.trim().orEmpty()
        val rawPhone = binding.etEditPhone.text?.toString()?.trim().orEmpty()

        if (name.isBlank()) {
            binding.etEditName.error = "Name is required"
            binding.etEditName.requestFocus()
            return
        }

        if (email.isBlank() || !android.util.Patterns.EMAIL_ADDRESS.matcher(email).matches()) {
            binding.etEditEmail.error = "Enter a valid email"
            binding.etEditEmail.requestFocus()
            return
        }

        val formattedPhone = if (rawPhone.isNotBlank()) {
            val digits = rawPhone.filter { it.isDigit() }
            if (digits.length != 10) {
                binding.etEditPhone.error = "Enter a valid 10-digit mobile number"
                binding.etEditPhone.requestFocus()
                return
            }
            "+91$digits"
        } else null

        binding.pbPersonalDetails.visibility = View.VISIBLE
        binding.btnSavePersonalDetails.isEnabled = false

        lifecycleScope.launch {
            val result = apiClient.updateProfile(
                name = name,
                email = email,
                phone = formattedPhone,
                addresses = user.addresses
            )
            binding.pbPersonalDetails.visibility = View.GONE
            binding.btnSavePersonalDetails.isEnabled = true

            when (result) {
                is NetworkResult.Success -> {
                    currentUser = result.data
                    Toast.makeText(this@EditProfileActivity, "Personal details saved successfully!", Toast.LENGTH_SHORT).show()
                }
                is NetworkResult.Error -> {
                    if (result.statusCode == 401) {
                        tokenManager.clearSession()
                        Toast.makeText(this@EditProfileActivity, "Your session has expired. Please sign in again.", Toast.LENGTH_LONG).show()
                        startActivity(Intent(this@EditProfileActivity, AuthActivity::class.java))
                        finish()
                    } else {
                        Toast.makeText(this@EditProfileActivity, result.message, Toast.LENGTH_LONG).show()
                    }
                }
                is NetworkResult.Loading -> {}
            }
        }
    }

    private fun updatePassword() {
        val currentPwd = binding.etCurrentPassword.text?.toString().orEmpty()
        val newPwd = binding.etNewPassword.text?.toString().orEmpty()
        val confirmPwd = binding.etConfirmNewPassword.text?.toString().orEmpty()

        if (currentPwd.isBlank()) {
            binding.etCurrentPassword.error = "Enter your current password"
            binding.etCurrentPassword.requestFocus()
            return
        }

        if (newPwd.length < 6) {
            binding.etNewPassword.error = "New password must be at least 6 characters"
            binding.etNewPassword.requestFocus()
            return
        }

        if (newPwd != confirmPwd) {
            binding.etConfirmNewPassword.error = "Passwords do not match"
            binding.etConfirmNewPassword.requestFocus()
            return
        }

        binding.pbUpdatePassword.visibility = View.VISIBLE
        binding.btnUpdatePassword.isEnabled = false

        lifecycleScope.launch {
            val result = apiClient.changePassword(currentPwd, newPwd)
            binding.pbUpdatePassword.visibility = View.GONE
            binding.btnUpdatePassword.isEnabled = true

            when (result) {
                is NetworkResult.Success -> {
                    Toast.makeText(this@EditProfileActivity, "Password updated successfully!", Toast.LENGTH_SHORT).show()
                    binding.etCurrentPassword.setText("")
                    binding.etNewPassword.setText("")
                    binding.etConfirmNewPassword.setText("")
                }
                is NetworkResult.Error -> {
                    if (result.statusCode == 401) {
                        tokenManager.clearSession()
                        Toast.makeText(this@EditProfileActivity, "Your session has expired. Please sign in again.", Toast.LENGTH_LONG).show()
                        startActivity(Intent(this@EditProfileActivity, AuthActivity::class.java))
                        finish()
                    } else {
                        Toast.makeText(this@EditProfileActivity, result.message, Toast.LENGTH_LONG).show()
                    }
                }
                is NetworkResult.Loading -> {}
            }
        }
    }
}
