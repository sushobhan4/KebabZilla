package com.kebabzilla.ui.address

import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout
import com.kebabzilla.R
import com.kebabzilla.data.api.ApiClient
import com.kebabzilla.data.api.NetworkResult
import com.kebabzilla.data.local.TokenManager
import com.kebabzilla.data.model.Address
import com.kebabzilla.data.model.User
import com.kebabzilla.databinding.ActivitySavedAddressesBinding
import com.kebabzilla.ui.auth.AuthActivity
import kotlinx.coroutines.launch

class SavedAddressesActivity : AppCompatActivity() {

    private lateinit var binding: ActivitySavedAddressesBinding
    private lateinit var apiClient: ApiClient
    private lateinit var tokenManager: TokenManager
    private lateinit var adapter: SavedAddressAdapter
    private var currentUser: User? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        binding = ActivitySavedAddressesBinding.inflate(layoutInflater)
        setContentView(binding.root)

        ViewCompat.setOnApplyWindowInsetsListener(binding.root) { _, insets ->
            val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            binding.root.setPadding(0, systemBars.top, 0, systemBars.bottom)
            insets
        }

        apiClient = ApiClient(this)
        tokenManager = TokenManager(this)
        setupRecyclerView()
        setupListeners()
    }

    override fun onResume() {
        super.onResume()
        if (!tokenManager.isLoggedIn()) {
            Toast.makeText(this, "Please sign in to view your saved addresses", Toast.LENGTH_SHORT).show()
            startActivity(Intent(this, AuthActivity::class.java))
            finish()
            return
        }
        loadAddresses()
    }

    private fun setupRecyclerView() {
        adapter = SavedAddressAdapter(
            onEditClick = { address ->
                // When edit button is pressed, open full screen Google map first!
                val intent = Intent(this, SelectDeliveryLocationActivity::class.java).apply {
                    putExtra("EXTRA_ADDRESS_TO_EDIT", address)
                    putExtra("EXTRA_ADDRESS_LABEL", address.label)
                }
                startActivity(intent)
            },
            onItemClick = { address ->
                setDefaultAddress(address)
            }
        )
        binding.rvSavedAddresses.layoutManager = LinearLayoutManager(this)
        binding.rvSavedAddresses.adapter = adapter
    }

    private fun setupListeners() {
        binding.btnBack.setOnClickListener {
            finish()
        }

        binding.btnAddNewAddress.setOnClickListener {
            val addresses = currentUser?.addresses ?: emptyList()
            if (addresses.none { it.isConfigured }) {
                // First configured address is always named "Home"
                val existingHome = addresses.firstOrNull { it.label.equals("Home", ignoreCase = true) }
                val intent = Intent(this, SelectDeliveryLocationActivity::class.java).apply {
                    putExtra("EXTRA_ADDRESS_LABEL", "Home")
                    if (existingHome != null) {
                        putExtra("EXTRA_ADDRESS_TO_EDIT", existingHome)
                    }
                }
                startActivity(intent)
            } else {
                // Ask name of the address via a popup text field before opening the map
                showAddressNameDialog()
            }
        }
    }

    private fun showAddressNameDialog() {
        val container = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            setPadding(56, 24, 56, 12)
        }
        val til = TextInputLayout(this).apply {
            hint = "Address Name (e.g. Work, Office, Other)"
            setBoxStrokeColor(getColor(R.color.brand_red))
        }
        val et = TextInputEditText(this).apply {
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_CAP_WORDS
            maxLines = 1
        }
        til.addView(et)
        container.addView(til)

        MaterialAlertDialogBuilder(this)
            .setTitle("New Address Name")
            .setMessage("Give this address a recognizable name:")
            .setView(container)
            .setPositiveButton("Continue to Map") { _, _ ->
                val name = et.text?.toString()?.trim().orEmpty()
                val finalName = name.ifBlank { "Address ${((currentUser?.addresses?.size ?: 0) + 1)}" }
                val intent = Intent(this, SelectDeliveryLocationActivity::class.java).apply {
                    putExtra("EXTRA_ADDRESS_LABEL", finalName)
                }
                startActivity(intent)
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun loadAddresses() {
        // 1. Immediately render cached addresses from local storage with 0 latency
        val cached = tokenManager.getUserProfile()
        if (cached != null) {
            currentUser = cached
            val addresses = cached.addresses
            binding.tvHeaderTitle.text = "YOUR SAVED LOCATIONS (${addresses.size})"
            if (addresses.isEmpty()) {
                binding.layoutEmptyAddresses.visibility = View.VISIBLE
                binding.rvSavedAddresses.visibility = View.GONE
            } else {
                binding.layoutEmptyAddresses.visibility = View.GONE
                binding.rvSavedAddresses.visibility = View.VISIBLE
                adapter.updateData(addresses)
            }
        } else {
            binding.pbSavedAddresses.visibility = View.VISIBLE
        }

        // 2. Sync fresh addresses from server in background
        lifecycleScope.launch {
            val result = apiClient.getMyProfile()
            binding.pbSavedAddresses.visibility = View.GONE
            when (result) {
                is NetworkResult.Success -> {
                    val user = result.data
                    currentUser = user
                    val addresses = user.addresses
                    binding.tvHeaderTitle.text = "YOUR SAVED LOCATIONS (${addresses.size})"

                    if (addresses.isEmpty()) {
                        binding.layoutEmptyAddresses.visibility = View.VISIBLE
                        binding.rvSavedAddresses.visibility = View.GONE
                    } else {
                        binding.layoutEmptyAddresses.visibility = View.GONE
                        binding.rvSavedAddresses.visibility = View.VISIBLE
                        adapter.updateData(addresses)
                    }
                }
                is NetworkResult.Error -> {
                    if (result.statusCode == 401) {
                        tokenManager.clearSession()
                        Toast.makeText(this@SavedAddressesActivity, "Your session has expired. Please sign in again.", Toast.LENGTH_LONG).show()
                        startActivity(Intent(this@SavedAddressesActivity, AuthActivity::class.java))
                        finish()
                    } else if (cached == null) {
                        Toast.makeText(this@SavedAddressesActivity, result.message, Toast.LENGTH_SHORT).show()
                    }
                }
                is NetworkResult.Loading -> {}
            }
        }
    }

    private fun setDefaultAddress(address: Address) {
        val user = currentUser ?: return
        val updatedAddresses = user.addresses.map {
            it.copy(isDefault = (it.id != null && it.id == address.id) || (it.fullAddressText == address.fullAddressText))
        }

        binding.pbSavedAddresses.visibility = View.VISIBLE
        lifecycleScope.launch {
            val result = apiClient.updateProfile(
                name = user.name,
                email = user.email,
                phone = user.phone,
                addresses = updatedAddresses
            )
            binding.pbSavedAddresses.visibility = View.GONE
            if (result is NetworkResult.Success) {
                currentUser = result.data
                loadAddresses()
                Toast.makeText(this@SavedAddressesActivity, "Default delivery location updated", Toast.LENGTH_SHORT).show()
            }
        }
    }
}
