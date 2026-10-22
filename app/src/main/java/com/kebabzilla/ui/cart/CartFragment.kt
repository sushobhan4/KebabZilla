package com.kebabzilla.ui.cart

import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ArrayAdapter
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.kebabzilla.MainActivity
import com.kebabzilla.R
import com.kebabzilla.data.api.ApiClient
import com.kebabzilla.data.api.NetworkResult
import com.kebabzilla.data.local.CartManager
import com.kebabzilla.data.local.DataCacheManager
import com.kebabzilla.data.local.TokenManager
import com.kebabzilla.data.model.Address
import com.kebabzilla.data.model.DeliveryEstimate
import com.kebabzilla.data.model.RestaurantInfo
import com.kebabzilla.databinding.FragmentCartBinding
import com.kebabzilla.ui.address.SavedAddressesActivity
import com.kebabzilla.ui.auth.AuthActivity
import com.kebabzilla.utils.Constants
import com.kebabzilla.utils.CurrencyFormatter
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

class CartFragment : Fragment() {

    private var _binding: FragmentCartBinding? = null
    private val binding get() = _binding!!

    private lateinit var apiClient: ApiClient
    private lateinit var tokenManager: TokenManager
    private lateinit var cartAdapter: CartItemAdapter

    private var isRestaurantOpen: Boolean = true
    private var isDeliveryOpen: Boolean = true
    private var restaurantInfo: RestaurantInfo? = null

    private var availableAddresses: List<Address> = emptyList()
    private var selectedAddress: Address? = null

    private var isEstimateLoading: Boolean = false
    private var estimateJob: Job? = null

    private var isScheduledOrder: Boolean = false
    private var remainingTimeSlots: List<Pair<String, String>> = emptyList()
    private var selectedScheduleSlot: String? = null

    private val cartListener = {
        recalculateDeliveryFeeAndRender()
    }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentCartBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        apiClient = ApiClient(requireContext())
        tokenManager = TokenManager(requireContext())

        setupRecyclerView()
        setupListeners()
        setupOrderTimingDropdown()
        loadSavedAddresses()
        checkStoreStatus()
        renderCart()
        CartManager.addListener(cartListener)
    }

    override fun onResume() {
        super.onResume()
        loadSavedAddresses()
        if (isScheduledOrder) {
            populateScheduleTimeSlots()
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        CartManager.removeListener(cartListener)
        _binding = null
    }

    private fun setupRecyclerView() {
        cartAdapter = CartItemAdapter(CartManager.getItems())
        binding.rvCartItems.apply {
            layoutManager = LinearLayoutManager(context)
            adapter = cartAdapter
        }
    }

    private fun setupListeners() {
        binding.btnCartBack.setOnClickListener {
            (activity as? MainActivity)?.showStorefront()
        }

        binding.btnExploreMenu.setOnClickListener {
            (activity as? MainActivity)?.selectTab(R.id.nav_storefront)
        }

        binding.btnClearCart.setOnClickListener {
            AlertDialog.Builder(requireContext())
                .setTitle("Clear Cart")
                .setMessage("Remove all items from your cart?")
                .setPositiveButton("Clear") { dialog, _ ->
                    CartManager.clear()
                    dialog.dismiss()
                }
                .setNegativeButton("Cancel", null)
                .show()
        }

        binding.btnManageAddresses.setOnClickListener {
            if (!tokenManager.isLoggedIn()) {
                startActivity(Intent(requireContext(), AuthActivity::class.java))
            } else {
                startActivity(Intent(requireContext(), SavedAddressesActivity::class.java))
            }
        }

        binding.cardPayOnline.setOnClickListener {
            binding.rbRazorpay.isChecked = true
            binding.rbCash.isChecked = false
        }

        binding.cardPayCash.setOnClickListener {
            binding.rbCash.isChecked = true
            binding.rbRazorpay.isChecked = false
        }

        binding.rbRazorpay.setOnCheckedChangeListener { _, isChecked ->
            if (isChecked) binding.rbCash.isChecked = false
        }

        binding.rbCash.setOnCheckedChangeListener { _, isChecked ->
            if (isChecked) binding.rbRazorpay.isChecked = false
        }

        binding.btnCheckout.setOnClickListener {
            handleCheckout()
        }
    }

    private fun setupOrderTimingDropdown() {
        val timingOptions = listOf("As soon as possible", "Schedule for later")
        val adapter = ArrayAdapter(requireContext(), android.R.layout.simple_dropdown_item_1line, timingOptions)
        binding.actvOrderTiming.setAdapter(adapter)
        binding.actvOrderTiming.setText(timingOptions[0], false)
        isScheduledOrder = false
        binding.tilScheduleTime.visibility = View.GONE

        binding.actvOrderTiming.setOnItemClickListener { _, _, position, _ ->
            if (position == 1) {
                isScheduledOrder = true
                binding.tilScheduleTime.visibility = View.VISIBLE
                populateScheduleTimeSlots()
            } else {
                isScheduledOrder = false
                binding.tilScheduleTime.visibility = View.GONE
                selectedScheduleSlot = null
            }
        }
    }

    private fun populateScheduleTimeSlots() {
        remainingTimeSlots = computeRemainingTimeSlots()
        if (remainingTimeSlots.isNotEmpty()) {
            val labels = remainingTimeSlots.map { it.second }
            val adapter = ArrayAdapter(requireContext(), android.R.layout.simple_dropdown_item_1line, labels)
            binding.actvScheduleTime.setAdapter(adapter)

            // Auto-select the first available slot
            val defaultSlot = remainingTimeSlots[0]
            selectedScheduleSlot = defaultSlot.first
            binding.actvScheduleTime.setText(defaultSlot.second, false)

            binding.actvScheduleTime.setOnItemClickListener { _, _, position, _ ->
                if (position in remainingTimeSlots.indices) {
                    selectedScheduleSlot = remainingTimeSlots[position].first
                }
            }
        } else {
            binding.actvScheduleTime.setAdapter(null)
            binding.actvScheduleTime.setText("No more delivery slots available today", false)
            selectedScheduleSlot = null
        }
    }

    private fun computeRemainingTimeSlots(): List<Pair<String, String>> {
        val now = Calendar.getInstance()
        val currentHour = now.get(Calendar.HOUR_OF_DAY)
        val currentMinute = now.get(Calendar.MINUTE)
        val nowMinutes = currentHour * 60 + currentMinute
        val minLeadMinutes = nowMinutes + 30 // 30-minute lead preparation buffer

        // Operating window: 11:00 AM (660 min) to 11:30 PM (1410 min)
        val startMin = 11 * 60
        val endMin = 23 * 60 + 30

        val slots = mutableListOf<Pair<String, String>>()
        val todayDateStr = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(now.time)

        for (totalMin in startMin..endMin step 15) {
            if (totalMin < minLeadMinutes) continue

            val h = totalMin / 60
            val m = totalMin % 60
            val padH = String.format(Locale.US, "%02d", h)
            val padM = String.format(Locale.US, "%02d", m)
            val ampm = if (h >= 12) "PM" else "AM"
            val displayH = if (h % 12 == 0) 12 else h % 12
            val displayLabel = String.format(Locale.US, "%02d:%02d %s", displayH, m, ampm)
            val isoSlot = "${todayDateStr}T${padH}:${padM}:00"

            slots.add(Pair(isoSlot, displayLabel))
        }
        return slots
    }

    private fun loadSavedAddresses() {
        if (!tokenManager.isLoggedIn()) {
            binding.actvDeliveryAddress.setAdapter(null)
            binding.actvDeliveryAddress.setText("Sign in to select delivery address", false)
            selectedAddress = null
            return
        }

        // 1. Instantly populate from local cached addresses
        val cachedAddresses = tokenManager.getAddresses().filter { it.isConfigured }
        if (cachedAddresses.isNotEmpty()) {
            bindAddressDropdown(cachedAddresses)
        }

        // 2. Sync latest addresses in background
        viewLifecycleOwner.lifecycleScope.launch {
            val profileResult = apiClient.getMyProfile()
            if (profileResult is NetworkResult.Success) {
                val freshAddresses = profileResult.data.addresses.filter { it.isConfigured }
                bindAddressDropdown(freshAddresses)
            } else if (profileResult is NetworkResult.Error && profileResult.statusCode == 401) {
                tokenManager.clearSession()
                binding.actvDeliveryAddress.setAdapter(null)
                binding.actvDeliveryAddress.setText("Sign in to select delivery address", false)
                selectedAddress = null
            }
        }
    }

    private fun bindAddressDropdown(addresses: List<Address>) {
        availableAddresses = addresses
        if (addresses.isEmpty()) {
            binding.actvDeliveryAddress.setAdapter(null)
            binding.actvDeliveryAddress.setText("No saved address. Tap to add one.", false)
            selectedAddress = null
            return
        }

        val labels = addresses.map { "${it.label} — ${it.fullAddressText}" }
        val adapter = ArrayAdapter(requireContext(), android.R.layout.simple_dropdown_item_1line, labels)
        binding.actvDeliveryAddress.setAdapter(adapter)

        // Select default address or first address
        val defaultAddr = addresses.firstOrNull { it.isDefault } ?: addresses.firstOrNull()
        selectedAddress = defaultAddr
        if (defaultAddr != null) {
            binding.actvDeliveryAddress.setText("${defaultAddr.label} — ${defaultAddr.fullAddressText}", false)
        }
        recalculateDeliveryFeeAndRender()

        binding.actvDeliveryAddress.setOnItemClickListener { _, _, position, _ ->
            if (position in addresses.indices) {
                selectedAddress = addresses[position]
                recalculateDeliveryFeeAndRender()
            }
        }
    }

    private fun checkStoreStatus() {
        viewLifecycleOwner.lifecycleScope.launch {
            val result = apiClient.getRestaurantInfo()
            if (result is NetworkResult.Success) {
                restaurantInfo = result.data
                isRestaurantOpen = result.data.isRestaurantOpen
                isDeliveryOpen = result.data.isDeliveryOpen
                recalculateDeliveryFeeAndRender()
            }
        }
    }

    private fun recalculateDeliveryFeeAndRender() {
        val items = CartManager.getItems()
        if (items.isEmpty()) {
            CartManager.updateDeliveryEstimate(null)
            renderCart()
            return
        }

        val addr = selectedAddress
        if (addr == null) {
            CartManager.updateDeliveryEstimate(null)
            renderCart()
            return
        }

        val lat = addr.latitude
        val lng = addr.longitude

        if (lat == null || lng == null) {
            CartManager.updateDeliveryEstimate(null)
            renderCart()
            return
        }

        val subtotalPaise = CartManager.getSubtotalPaise()

        estimateJob?.cancel()
        isEstimateLoading = true
        renderCart()

        estimateJob = viewLifecycleOwner.lifecycleScope.launch {
            val result = apiClient.getDeliveryEstimate(lat, lng, subtotalPaise)
            isEstimateLoading = false
            if (result is NetworkResult.Success) {
                CartManager.updateDeliveryEstimate(result.data)
            } else {
                val fallback = computeLocalDeliveryEstimate(addr, subtotalPaise)
                CartManager.updateDeliveryEstimate(fallback)
            }
            renderCart()
        }
    }

    private fun computeLocalDeliveryEstimate(addr: Address, subtotalPaise: Long): DeliveryEstimate? {
        val lat = addr.latitude ?: return null
        val lng = addr.longitude ?: return null
        val rest = restaurantInfo ?: DataCacheManager(requireContext()).getCachedRestaurantInfo() ?: RestaurantInfo()

        val rLat = rest.latitude ?: Constants.RESTAURANT_LATITUDE
        val rLng = rest.longitude ?: Constants.RESTAURANT_LONGITUDE

        val results = FloatArray(1)
        android.location.Location.distanceBetween(rLat, rLng, lat, lng, results)
        val factor = 1.3
        val distKm = Math.round((results[0] / 1000.0) * factor * 100.0) / 100.0
        val withinRadius = distKm <= rest.deliveryRadiusKm
        val isFreeByThreshold = rest.freeDeliveryThresholdPaise > 0L && subtotalPaise >= rest.freeDeliveryThresholdPaise

        val rawFeePaise: Long
        val feePaise: Long
        val roundOffPaise: Long

        if (!withinRadius || isFreeByThreshold || distKm <= rest.freeDeliveryRadiusKm) {
            rawFeePaise = 0L
            feePaise = 0L
            roundOffPaise = 0L
        } else {
            val billableKm = if (rest.chargeFromZeroBeyondFreeRadius) distKm else (distKm - rest.freeDeliveryRadiusKm)
            val feePerKmInr = rest.deliveryFeePerKmPaise / 100.0
            val rawFeeInr = Math.round(billableKm * feePerKmInr * 100.0) / 100.0
            val roundedFeeInr = Math.ceil(rawFeeInr)
            roundOffPaise = Math.round((roundedFeeInr - rawFeeInr) * 100.0)
            rawFeePaise = Math.round(rawFeeInr * 100.0)
            feePaise = (roundedFeeInr * 100.0).toLong()
        }

        return DeliveryEstimate(
            distanceKm = distKm,
            method = "HAVERSINE_LOCAL",
            deliveryFeePaise = feePaise,
            deliveryFeeInr = feePaise / 100.0,
            rawDeliveryFeePaise = rawFeePaise,
            rawDeliveryFeeInr = rawFeePaise / 100.0,
            roundOffPaise = roundOffPaise,
            withinRadius = withinRadius,
            maxRadiusKm = rest.deliveryRadiusKm,
            freeRadiusKm = rest.freeDeliveryRadiusKm,
            freeDeliveryThresholdPaise = rest.freeDeliveryThresholdPaise,
            feePerKmPaise = rest.deliveryFeePerKmPaise,
            isFreeByThreshold = isFreeByThreshold
        )
    }

    private fun updateCheckoutButtonState() {
        val total = CartManager.getTotalPaise()
        val estimate = CartManager.deliveryEstimate
        if (!isRestaurantOpen || !isDeliveryOpen) {
            binding.btnCheckout.isEnabled = false
            binding.btnCheckout.text = if (!isRestaurantOpen) "Sorry, we are closed" else "Walk-in only (Delivery offline)"
            binding.btnCheckout.alpha = 0.6f
        } else if (selectedAddress != null && estimate != null && !estimate.withinRadius) {
            binding.btnCheckout.isEnabled = false
            binding.btnCheckout.text = "Outside delivery zone (${estimate.distanceKm} km)"
            binding.btnCheckout.alpha = 0.6f
        } else {
            binding.btnCheckout.isEnabled = true
            binding.btnCheckout.text = "Place Order · ${CurrencyFormatter.formatPaise(total)}"
            binding.btnCheckout.alpha = 1.0f
        }
    }

    private fun renderCart() {
        val items = CartManager.getItems()
        if (items.isEmpty()) {
            binding.layoutCartEmpty.visibility = View.VISIBLE
            binding.layoutCartContentContainer.visibility = View.GONE
        } else {
            binding.layoutCartEmpty.visibility = View.GONE
            binding.layoutCartContentContainer.visibility = View.VISIBLE

            cartAdapter.updateList(items)

            val totalCount = items.sumOf { it.quantity }
            binding.tvCartHeaderBadge.text = if (totalCount == 1) "1 item" else "$totalCount items"

            val subtotal = CartManager.getSubtotalPaise()
            val total = CartManager.getTotalPaise()
            val estimate = CartManager.deliveryEstimate
            val roundOffPaise = CartManager.roundOffPaise

            binding.tvBillSubtotal.text = CurrencyFormatter.formatPaise(subtotal)

            // Delivery Fee presentation matching website storefront
            binding.tvBillDeliveryNotice.visibility = View.GONE
            if (isEstimateLoading) {
                binding.tvBillDelivery.text = "Calculating…"
                binding.tvBillDelivery.setTextColor(requireContext().getColor(R.color.brand_muted))
            } else if (selectedAddress == null) {
                binding.tvBillDelivery.text = "Select address"
                binding.tvBillDelivery.setTextColor(requireContext().getColor(R.color.brand_muted))
            } else if (selectedAddress?.latitude == null || selectedAddress?.longitude == null) {
                binding.tvBillDelivery.text = "Pin address on map"
                binding.tvBillDelivery.setTextColor(requireContext().getColor(R.color.brand_muted))
            } else if (estimate != null) {
                if (!estimate.withinRadius) {
                    binding.tvBillDelivery.text = "Outside delivery zone"
                    binding.tvBillDelivery.setTextColor(requireContext().getColor(R.color.brand_red))
                } else if (CartManager.rawDeliveryFeePaise == 0L || estimate.isFreeByThreshold) {
                    binding.tvBillDelivery.text = "FREE"
                    binding.tvBillDelivery.setTextColor(requireContext().getColor(R.color.brand_green))
                    if (estimate.isFreeByThreshold && estimate.freeDeliveryThresholdPaise > 0L) {
                        binding.tvBillDeliveryNotice.visibility = View.VISIBLE
                        binding.tvBillDeliveryNotice.text = "Free delivery (Order over ${CurrencyFormatter.formatPaise(estimate.freeDeliveryThresholdPaise)})"
                    }
                } else {
                    binding.tvBillDelivery.text = CurrencyFormatter.formatPaise(CartManager.rawDeliveryFeePaise)
                    binding.tvBillDelivery.setTextColor(requireContext().getColor(R.color.brand_ink))
                }
            } else {
                binding.tvBillDelivery.text = "FREE"
                binding.tvBillDelivery.setTextColor(requireContext().getColor(R.color.brand_green))
            }

            // Round Off presentation (ONLY SHOWN IF NEEDED)
            if (roundOffPaise != 0L && selectedAddress != null && estimate?.withinRadius == true) {
                binding.layoutBillRoundOff.visibility = View.VISIBLE
                val sign = if (roundOffPaise > 0) "+" else "-"
                val absPaise = kotlin.math.abs(roundOffPaise)
                binding.tvBillRoundOff.text = "$sign${CurrencyFormatter.formatPaise(absPaise)}"
            } else {
                binding.layoutBillRoundOff.visibility = View.GONE
            }

            binding.tvBillTotal.text = CurrencyFormatter.formatPaise(total)

            updateCheckoutButtonState()
        }
    }

    private fun handleCheckout() {
        if (!isRestaurantOpen || !isDeliveryOpen) {
            Toast.makeText(
                requireContext(),
                if (!isRestaurantOpen) "Restaurant is closed for ordering" else "Delivery is currently offline",
                Toast.LENGTH_SHORT
            ).show()
            return
        }

        if (!tokenManager.isLoggedIn()) {
            Toast.makeText(requireContext(), "Please sign in to place your order", Toast.LENGTH_SHORT).show()
            startActivity(Intent(requireContext(), AuthActivity::class.java))
            return
        }

        val addressText = selectedAddress?.fullAddressText
            ?: binding.actvDeliveryAddress.text?.toString()?.trim().orEmpty()

        if (addressText.isBlank() || addressText.startsWith("No saved") || addressText.startsWith("Sign in")) {
            Toast.makeText(requireContext(), "Please select or add a delivery address", Toast.LENGTH_SHORT).show()
            startActivity(Intent(requireContext(), SavedAddressesActivity::class.java))
            return
        }

        if (selectedAddress != null && CartManager.deliveryEstimate?.withinRadius == false) {
            val dist = CartManager.deliveryEstimate?.distanceKm ?: 0.0
            val maxR = CartManager.deliveryEstimate?.maxRadiusKm ?: 10.0
            Toast.makeText(
                requireContext(),
                "Your address is $dist km away, which exceeds our maximum delivery radius of $maxR km.",
                Toast.LENGTH_LONG
            ).show()
            return
        }

        if (isScheduledOrder && selectedScheduleSlot.isNullOrBlank()) {
            Toast.makeText(requireContext(), "Please select a scheduled delivery time slot", Toast.LENGTH_SHORT).show()
            return
        }

        val instructions = binding.etCookingInstructions.text?.toString()?.trim()
        val paymentMethod = if (binding.rbCash.isChecked) Constants.PAYMENT_COD else Constants.PAYMENT_RAZORPAY
        val items = CartManager.getItems()

        binding.btnCheckout.isEnabled = false
        binding.btnCheckout.text = "Placing Order..."

        viewLifecycleOwner.lifecycleScope.launch {
            val result = apiClient.createOrder(
                items = items,
                paymentMethod = paymentMethod,
                address = addressText,
                notes = instructions,
                scheduledFor = if (isScheduledOrder) selectedScheduleSlot else null,
                latitude = selectedAddress?.latitude,
                longitude = selectedAddress?.longitude
            )

            binding.btnCheckout.isEnabled = true
            binding.btnCheckout.text = "Place Order"

            when (result) {
                is NetworkResult.Success -> {
                    val order = result.data
                    CartManager.clear()

                    val timingMsg = if (isScheduledOrder && !selectedScheduleSlot.isNullOrBlank()) {
                        val displayTime = remainingTimeSlots.find { it.first == selectedScheduleSlot }?.second
                        "\nScheduled for delivery at ${displayTime ?: "selected time"} today."
                    } else ""

                    val otpMsg = if (!order.deliveryOtp.isNullOrBlank()) {
                        "\n\nYour Delivery OTP is ${order.deliveryOtp}.\nPlease share it with the rider upon arrival."
                    } else ""

                    AlertDialog.Builder(requireContext())
                        .setTitle("Order Placed Successfully!")
                        .setMessage("Your order #${order.orderId} has been placed.$timingMsg$otpMsg")
                        .setPositiveButton("Track Order") { dialog, _ ->
                            dialog.dismiss()
                            (activity as? MainActivity)?.selectTab(R.id.nav_orders)
                        }
                        .setCancelable(false)
                        .show()
                }
                is NetworkResult.Error -> {
                    if (result.statusCode == 401) {
                        tokenManager.clearSession()
                        Toast.makeText(requireContext(), "Your session has expired. Please sign in again.", Toast.LENGTH_LONG).show()
                        startActivity(Intent(requireContext(), AuthActivity::class.java))
                    } else {
                        Toast.makeText(requireContext(), result.message, Toast.LENGTH_LONG).show()
                    }
                }
                is NetworkResult.Loading -> {}
            }
        }
    }
}
