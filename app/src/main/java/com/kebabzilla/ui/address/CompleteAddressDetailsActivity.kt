package com.kebabzilla.ui.address

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.lifecycleScope
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.GoogleMap
import com.google.android.gms.maps.OnMapReadyCallback
import com.google.android.gms.maps.SupportMapFragment
import com.google.android.gms.maps.model.LatLng
import com.google.android.gms.maps.model.MarkerOptions
import com.kebabzilla.R
import com.kebabzilla.data.api.ApiClient
import com.kebabzilla.data.api.NetworkResult
import com.kebabzilla.data.local.TokenManager
import com.kebabzilla.data.model.Address
import com.kebabzilla.databinding.ActivityCompleteAddressDetailsBinding
import com.kebabzilla.ui.auth.AuthActivity
import com.kebabzilla.utils.Constants
import kotlinx.coroutines.launch

class CompleteAddressDetailsActivity : AppCompatActivity(), OnMapReadyCallback {

    private lateinit var binding: ActivityCompleteAddressDetailsBinding
    private lateinit var apiClient: ApiClient
    private lateinit var tokenManager: TokenManager

    private var pinnedLatitude: Double = Constants.RESTAURANT_LATITUDE
    private var pinnedLongitude: Double = Constants.RESTAURANT_LONGITUDE
    private var addressLabel: String = "Home"
    private var editingAddress: Address? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        binding = ActivityCompleteAddressDetailsBinding.inflate(layoutInflater)
        setContentView(binding.root)

        ViewCompat.setOnApplyWindowInsetsListener(binding.root) { _, insets ->
            val navInsets = insets.getInsets(WindowInsetsCompat.Type.navigationBars())
            val statusInsets = insets.getInsets(WindowInsetsCompat.Type.statusBars())
            binding.layoutTopBar.setPadding(0, statusInsets.top, 0, 0)

            val bottomPadding = navInsets.bottom + (14 * resources.displayMetrics.density).toInt()
            binding.layoutStickyBottom.setPadding(
                binding.layoutStickyBottom.paddingStart,
                binding.layoutStickyBottom.paddingTop,
                binding.layoutStickyBottom.paddingEnd,
                bottomPadding
            )
            insets
        }

        tokenManager = TokenManager(this)
        if (!tokenManager.isLoggedIn()) {
            Toast.makeText(this, "Please sign in to save your address", Toast.LENGTH_SHORT).show()
            startActivity(Intent(this, AuthActivity::class.java))
            finish()
            return
        }

        apiClient = ApiClient(this)

        extractIntentData()
        setupListeners()

        val mapFragment = supportFragmentManager.findFragmentById(R.id.liteMapFragment) as? SupportMapFragment
        mapFragment?.getMapAsync(this)
    }

    @Suppress("DEPRECATION")
    private fun extractIntentData() {
        addressLabel = intent.getStringExtra("EXTRA_ADDRESS_LABEL") ?: "Home"
        editingAddress = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getSerializableExtra("EXTRA_ADDRESS_TO_EDIT", Address::class.java)
        } else {
            intent.getSerializableExtra("EXTRA_ADDRESS_TO_EDIT") as? Address
        }

        binding.tvScreenTitle.text = "Complete Address: $addressLabel"

        val edit = editingAddress
        if (edit != null) {
            pinnedLatitude = edit.latitude ?: intent.getDoubleExtra("EXTRA_LATITUDE", Constants.RESTAURANT_LATITUDE)
            pinnedLongitude = edit.longitude ?: intent.getDoubleExtra("EXTRA_LONGITUDE", Constants.RESTAURANT_LONGITUDE)
            addressLabel = edit.label

            binding.etHouseNumber.setText(edit.houseNumber.orEmpty())

            val road = intent.getStringExtra("EXTRA_ROAD")?.takeIf { it.isNotBlank() } ?: edit.road.orEmpty()
            val area = intent.getStringExtra("EXTRA_AREA")?.takeIf { it.isNotBlank() } ?: edit.area.orEmpty()
            val city = intent.getStringExtra("EXTRA_CITY")?.takeIf { it.isNotBlank() } ?: edit.city.ifBlank { "Amtala" }
            val pincode = intent.getStringExtra("EXTRA_PINCODE")?.takeIf { it.isNotBlank() } ?: edit.pincode.orEmpty()

            binding.etRoadName.setText(road)
            binding.etAreaLocality.setText(area)
            binding.etCity.setText(city)
            binding.etPincode.setText(pincode)
            binding.etLandmark.setText(edit.landmark.orEmpty())
            binding.switchDefaultAddress.isChecked = edit.isDefault

            val locName = area.ifBlank { city }
            binding.tvPinnedLocality.text = locName
        } else {
            pinnedLatitude = intent.getDoubleExtra("EXTRA_LATITUDE", Constants.RESTAURANT_LATITUDE)
            pinnedLongitude = intent.getDoubleExtra("EXTRA_LONGITUDE", Constants.RESTAURANT_LONGITUDE)

            // Pre-fill all necessary address fields from the user dropped pin hit
            val road = intent.getStringExtra("EXTRA_ROAD").orEmpty()
            val area = intent.getStringExtra("EXTRA_AREA").orEmpty()
            val city = intent.getStringExtra("EXTRA_CITY") ?: "Amtala"
            val pincode = intent.getStringExtra("EXTRA_PINCODE").orEmpty()

            binding.etRoadName.setText(road)
            binding.etAreaLocality.setText(area)
            binding.etCity.setText(city)
            binding.etPincode.setText(pincode)

            // Leaving only house number and landmark empty for the user to type
            val locName = area.ifBlank { city }
            binding.tvPinnedLocality.text = locName
        }
    }

    override fun onMapReady(map: GoogleMap) {
        val target = LatLng(pinnedLatitude, pinnedLongitude)
        map.uiSettings.setAllGesturesEnabled(false)
        map.uiSettings.isMapToolbarEnabled = false
        map.moveCamera(CameraUpdateFactory.newLatLngZoom(target, 16f))
        map.addMarker(MarkerOptions().position(target))
    }

    private fun setupListeners() {
        binding.btnBack.setOnClickListener {
            finish()
        }

        binding.btnChangePin.setOnClickListener {
            finish() // returns back to SelectDeliveryLocationActivity
        }

        binding.btnSaveAddress.setOnClickListener {
            saveAddress()
        }
    }

    private fun saveAddress() {
        val house = binding.etHouseNumber.text?.toString()?.trim().orEmpty()
        val road = binding.etRoadName.text?.toString()?.trim().orEmpty()
        val area = binding.etAreaLocality.text?.toString()?.trim().orEmpty()
        val city = binding.etCity.text?.toString()?.trim().orEmpty()
        val pincode = binding.etPincode.text?.toString()?.trim().orEmpty()
        val landmark = binding.etLandmark.text?.toString()?.trim().orEmpty()
        val isDefault = binding.switchDefaultAddress.isChecked

        if (house.isBlank()) {
            binding.etHouseNumber.error = "House / Flat number is required"
            binding.etHouseNumber.requestFocus()
            return
        }

        if (road.isBlank()) {
            binding.etRoadName.error = "Apartment / Road name is required"
            binding.etRoadName.requestFocus()
            return
        }

        if (area.isBlank()) {
            binding.etAreaLocality.error = "Area / Locality is required"
            binding.etAreaLocality.requestFocus()
            return
        }

        if (city.isBlank()) {
            binding.etCity.error = "City is required"
            binding.etCity.requestFocus()
            return
        }

        if (pincode.length != 6) {
            binding.etPincode.error = "Enter a valid 6-digit PIN code"
            binding.etPincode.requestFocus()
            return
        }

        val targetId = editingAddress?.id?.takeIf { it.isNotBlank() }
            ?: if (addressLabel.equals("home", ignoreCase = true)) "home"
               else if (addressLabel.equals("work", ignoreCase = true)) "work"
               else "addr_${System.currentTimeMillis()}"

        val addressToSave = Address(
            id = targetId,
            label = addressLabel,
            houseNumber = house,
            road = road,
            area = area,
            city = city,
            pincode = pincode,
            landmark = landmark.ifBlank { null },
            latitude = pinnedLatitude,
            longitude = pinnedLongitude,
            isDefault = isDefault
        )

        setLoading(true)
        lifecycleScope.launch {
            val user = tokenManager.getUserProfile() ?: run {
                val profileRes = apiClient.getMyProfile()
                if (profileRes is NetworkResult.Error) {
                    setLoading(false)
                    if (profileRes.statusCode == 401) {
                        tokenManager.clearSession()
                        Toast.makeText(this@CompleteAddressDetailsActivity, "Your session has expired. Please sign in again.", Toast.LENGTH_LONG).show()
                        startActivity(Intent(this@CompleteAddressDetailsActivity, AuthActivity::class.java))
                        finish()
                    } else {
                        Toast.makeText(this@CompleteAddressDetailsActivity, profileRes.message, Toast.LENGTH_SHORT).show()
                    }
                    return@launch
                }
                if (profileRes !is NetworkResult.Success) {
                    setLoading(false)
                    return@launch
                }
                profileRes.data
            }

            val currentAddresses = user.addresses.toMutableList()

            val willBeDefault = isDefault || currentAddresses.isEmpty()

            if (willBeDefault) {
                for (i in currentAddresses.indices) {
                    currentAddresses[i] = currentAddresses[i].copy(isDefault = false)
                }
            }

            val existingIndex = currentAddresses.indexOfFirst {
                (!it.id.isNullOrBlank() && it.id == targetId) ||
                (targetId == "home" && (it.id == "home" || it.label.equals("home", ignoreCase = true))) ||
                (it.label.equals(addressLabel, ignoreCase = true))
            }

            val finalId = if (existingIndex >= 0 && !currentAddresses[existingIndex].id.isNullOrBlank()) {
                currentAddresses[existingIndex].id
            } else targetId

            val finalAddress = addressToSave.copy(
                id = finalId,
                isDefault = willBeDefault
            )

            if (existingIndex >= 0) {
                currentAddresses[existingIndex] = finalAddress
            } else {
                currentAddresses.add(finalAddress)
            }

            val updateRes = apiClient.updateProfile(
                name = user.name,
                email = user.email,
                phone = user.phone,
                addresses = currentAddresses
            )

            setLoading(false)
            when (updateRes) {
                is NetworkResult.Success -> {
                    Toast.makeText(this@CompleteAddressDetailsActivity, "Address saved successfully!", Toast.LENGTH_SHORT).show()
                    val intent = Intent(this@CompleteAddressDetailsActivity, SavedAddressesActivity::class.java).apply {
                        flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
                    }
                    startActivity(intent)
                    finish()
                }
                is NetworkResult.Error -> {
                    if (updateRes.statusCode == 401) {
                        tokenManager.clearSession()
                        Toast.makeText(this@CompleteAddressDetailsActivity, "Your session has expired. Please sign in again.", Toast.LENGTH_LONG).show()
                        startActivity(Intent(this@CompleteAddressDetailsActivity, AuthActivity::class.java))
                        finish()
                    } else {
                        Toast.makeText(this@CompleteAddressDetailsActivity, updateRes.message, Toast.LENGTH_LONG).show()
                    }
                }
                is NetworkResult.Loading -> {}
            }
        }
    }

    private fun setLoading(loading: Boolean) {
        binding.pbSavingAddress.visibility = if (loading) View.VISIBLE else View.GONE
        binding.btnSaveAddress.isEnabled = !loading
    }
}
