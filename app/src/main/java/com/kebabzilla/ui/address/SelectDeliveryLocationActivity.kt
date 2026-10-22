package com.kebabzilla.ui.address

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Address as AndroidAddress
import android.location.Geocoder
import android.location.Location
import android.os.Build
import android.os.Bundle
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.lifecycleScope
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationServices
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.GoogleMap
import com.google.android.gms.maps.OnMapReadyCallback
import com.google.android.gms.maps.SupportMapFragment
import com.google.android.gms.maps.model.LatLng
import com.google.android.gms.maps.model.LatLngBounds
import com.kebabzilla.R
import com.kebabzilla.data.api.ApiClient
import com.kebabzilla.data.api.NetworkResult
import com.kebabzilla.data.model.Address
import com.kebabzilla.databinding.ActivitySelectDeliveryLocationBinding
import com.kebabzilla.utils.Constants
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.Locale
import kotlin.math.cos

class SelectDeliveryLocationActivity : AppCompatActivity(), OnMapReadyCallback {

    private lateinit var binding: ActivitySelectDeliveryLocationBinding
    private lateinit var apiClient: ApiClient
    private var googleMap: GoogleMap? = null
    private lateinit var fusedLocationClient: FusedLocationProviderClient

    private var amtalaCenter = LatLng(Constants.RESTAURANT_LATITUDE, Constants.RESTAURANT_LONGITUDE)
    private var deliveryRadiusKm = Constants.DEFAULT_DELIVERY_RADIUS_KM
    private var currentPinnedLatLng: LatLng = amtalaCenter

    private var addressLabel: String = "Home"
    private var editingAddress: Address? = null

    private var resolvedRoad: String = ""
    private var resolvedArea: String = ""
    private var resolvedCity: String = "Amtala"
    private var resolvedPincode: String = ""
    private var resolvedFullAddress: String = ""
    private var isInsideDeliveryZone = true

    private val locationPermissionRequest = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val fineGranted = permissions[Manifest.permission.ACCESS_FINE_LOCATION] ?: false
        val coarseGranted = permissions[Manifest.permission.ACCESS_COARSE_LOCATION] ?: false
        if (fineGranted || coarseGranted) {
            moveToCurrentGpsLocation()
        } else {
            Toast.makeText(this, "Location permission required to find your location", Toast.LENGTH_SHORT).show()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        binding = ActivitySelectDeliveryLocationBinding.inflate(layoutInflater)
        setContentView(binding.root)

        ViewCompat.setOnApplyWindowInsetsListener(binding.root) { _, insets ->
            val navInsets = insets.getInsets(WindowInsetsCompat.Type.navigationBars())
            val statusInsets = insets.getInsets(WindowInsetsCompat.Type.statusBars())
            binding.layoutTopControls.setPadding(0, statusInsets.top, 0, 0)

            val bottomPadding = navInsets.bottom + (16 * resources.displayMetrics.density).toInt()
            binding.layoutBottomCardInner.setPadding(
                binding.layoutBottomCardInner.paddingStart,
                binding.layoutBottomCardInner.paddingTop,
                binding.layoutBottomCardInner.paddingEnd,
                bottomPadding
            )

            val locateMeParams = binding.btnLocateMe.layoutParams as? FrameLayout.LayoutParams
            if (locateMeParams != null) {
                locateMeParams.bottomMargin = bottomPadding + (110 * resources.displayMetrics.density).toInt()
                binding.btnLocateMe.layoutParams = locateMeParams
            }

            insets
        }

        apiClient = ApiClient(this)
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)

        extractIntentData()

        val mapFragment = supportFragmentManager.findFragmentById(R.id.mapFragment) as? SupportMapFragment
        mapFragment?.getMapAsync(this)

        setupListeners()
        fetchRestaurantZone()
    }

    @Suppress("DEPRECATION")
    private fun extractIntentData() {
        addressLabel = intent.getStringExtra("EXTRA_ADDRESS_LABEL") ?: "Home"
        editingAddress = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getSerializableExtra("EXTRA_ADDRESS_TO_EDIT", Address::class.java)
        } else {
            intent.getSerializableExtra("EXTRA_ADDRESS_TO_EDIT") as? Address
        }

        val edit = editingAddress
        if (edit != null) {
            addressLabel = edit.label
            binding.tvMapTitle.text = "Edit Address: ${edit.label}"
            if (edit.latitude != null && edit.longitude != null) {
                currentPinnedLatLng = LatLng(edit.latitude, edit.longitude)
            }
        } else {
            binding.tvMapTitle.text = "Set Location: $addressLabel"
        }
    }

    private fun setupListeners() {
        binding.btnBack.setOnClickListener {
            finish()
        }

        binding.btnLocateMe.setOnClickListener {
            checkAndRequestLocation()
        }

        binding.btnCompleteAddress.setOnClickListener {
            if (!isInsideDeliveryZone) {
                Toast.makeText(this, "Pinned location is outside delivery area", Toast.LENGTH_LONG).show()
                return@setOnClickListener
            }

            val intent = Intent(this, CompleteAddressDetailsActivity::class.java).apply {
                putExtra("EXTRA_LATITUDE", currentPinnedLatLng.latitude)
                putExtra("EXTRA_LONGITUDE", currentPinnedLatLng.longitude)
                putExtra("EXTRA_ROAD", resolvedRoad)
                putExtra("EXTRA_AREA", resolvedArea)
                putExtra("EXTRA_CITY", resolvedCity)
                putExtra("EXTRA_PINCODE", resolvedPincode)
                putExtra("EXTRA_FULL_ADDRESS", resolvedFullAddress)
                putExtra("EXTRA_ADDRESS_LABEL", addressLabel)
                putExtra("EXTRA_ADDRESS_TO_EDIT", editingAddress)
            }
            startActivity(intent)
        }
    }

    private fun fetchRestaurantZone() {
        lifecycleScope.launch {
            val result = apiClient.getRestaurantInfo()
            if (result is NetworkResult.Success) {
                deliveryRadiusKm = result.data.deliveryRadiusKm
            }
        }
    }

    override fun onMapReady(map: GoogleMap) {
        googleMap = map
        map.uiSettings.isMapToolbarEnabled = false
        map.uiSettings.isMyLocationButtonEnabled = false
        map.uiSettings.isCompassEnabled = true

        // Center on Amtala and fit entire permissible range to screen
        fitDeliveryZoneToScreen()

        map.setOnCameraIdleListener {
            val target = map.cameraPosition.target
            currentPinnedLatLng = target
            checkDeliveryZone(target)
            reverseGeocode(target)
        }

        // Tap on map to drop/move pin
        map.setOnMapClickListener { latLng ->
            map.animateCamera(CameraUpdateFactory.newLatLng(latLng))
        }
    }

    private fun fitDeliveryZoneToScreen() {
        val map = googleMap ?: return

        val latOffset = (deliveryRadiusKm / 111.0) * 1.2
        val lngOffset = (deliveryRadiusKm / (111.0 * cos(Math.toRadians(amtalaCenter.latitude)))) * 1.2

        val bounds = LatLngBounds(
            LatLng(amtalaCenter.latitude - latOffset, amtalaCenter.longitude - lngOffset),
            LatLng(amtalaCenter.latitude + latOffset, amtalaCenter.longitude + lngOffset)
        )

        try {
            map.moveCamera(CameraUpdateFactory.newLatLngBounds(bounds, 80))
        } catch (_: Exception) {
            map.moveCamera(CameraUpdateFactory.newLatLngZoom(amtalaCenter, 11.2f))
        }
    }

    private fun checkDeliveryZone(target: LatLng) {
        val results = FloatArray(1)
        Location.distanceBetween(
            amtalaCenter.latitude,
            amtalaCenter.longitude,
            target.latitude,
            target.longitude,
            results
        )
        val distKm = results[0] / 1000.0

        if (distKm <= deliveryRadiusKm) {
            isInsideDeliveryZone = true
            binding.btnCompleteAddress.isEnabled = true
            binding.btnCompleteAddress.alpha = 1.0f
        } else {
            isInsideDeliveryZone = false
            binding.btnCompleteAddress.isEnabled = false
            binding.btnCompleteAddress.alpha = 0.5f
        }
    }

    private fun reverseGeocode(latLng: LatLng) {
        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val geocoder = Geocoder(this@SelectDeliveryLocationActivity, Locale.getDefault())
                val addressList: List<AndroidAddress>? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    var list: List<AndroidAddress>? = null
                    geocoder.getFromLocation(latLng.latitude, latLng.longitude, 1) { addrs ->
                        list = addrs
                    }
                    list
                } else {
                    @Suppress("DEPRECATION")
                    geocoder.getFromLocation(latLng.latitude, latLng.longitude, 1)
                }

                if (!addressList.isNullOrEmpty()) {
                    val addr = addressList[0]
                    val road = addr.thoroughfare ?: addr.subThoroughfare.orEmpty()
                    val area = addr.subLocality ?: addr.locality.orEmpty()
                    val city = addr.locality ?: addr.subAdminArea ?: "Amtala"
                    val pincode = addr.postalCode.orEmpty()

                    val fullLines = (0..addr.maxAddressLineIndex).mapNotNull { addr.getAddressLine(it) }.joinToString(", ")
                    val full = fullLines.ifBlank {
                        listOfNotNull(road, area, city, pincode).filter { it.isNotBlank() }.joinToString(", ")
                    }

                    withContext(Dispatchers.Main) {
                        resolvedRoad = road
                        resolvedArea = area
                        resolvedCity = city
                        resolvedPincode = pincode
                        resolvedFullAddress = full

                        binding.tvPinLocalityTitle.text = area.ifBlank { city.ifBlank { "Pinned Location" } }
                        // Display human-readable road and area without latitude/longitude coordinates
                        val subText = listOfNotNull(road, city, pincode).filter { it.isNotBlank() }.joinToString(", ")
                        binding.tvPinAddressSub.text = subText.ifBlank { "Amtala, South 24 Parganas" }
                    }
                } else {
                    withContext(Dispatchers.Main) {
                        binding.tvPinLocalityTitle.text = "Delivery Location"
                        binding.tvPinAddressSub.text = "Amtala area, South 24 Parganas"
                        resolvedFullAddress = "Amtala area, South 24 Parganas"
                    }
                }
            } catch (_: Exception) {
                withContext(Dispatchers.Main) {
                    binding.tvPinLocalityTitle.text = "Delivery Location"
                    binding.tvPinAddressSub.text = "Amtala area, South 24 Parganas"
                    resolvedFullAddress = "Amtala area, South 24 Parganas"
                }
            }
        }
    }

    private fun hasLocationPermission(): Boolean {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
                ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
    }

    private fun checkAndRequestLocation() {
        if (hasLocationPermission()) {
            moveToCurrentGpsLocation()
        } else {
            locationPermissionRequest.launch(
                arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
            )
        }
    }

    @SuppressLint("MissingPermission")
    private fun moveToCurrentGpsLocation() {
        if (!hasLocationPermission()) return
        fusedLocationClient.lastLocation.addOnSuccessListener { location: Location? ->
            if (location != null) {
                val userLatLng = LatLng(location.latitude, location.longitude)
                googleMap?.animateCamera(CameraUpdateFactory.newLatLngZoom(userLatLng, 16f))
            } else {
                Toast.makeText(this, "Acquiring GPS location...", Toast.LENGTH_SHORT).show()
            }
        }
    }
}
