package com.kebabzilla.ui.menu

import android.content.Context
import android.graphics.Paint
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.doOnLayout
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.kebabzilla.MainActivity
import com.kebabzilla.R
import com.kebabzilla.data.api.ApiClient
import com.kebabzilla.data.api.NetworkResult
import com.kebabzilla.data.local.CartManager
import com.kebabzilla.data.local.DataCacheManager
import com.kebabzilla.data.local.TokenManager
import com.kebabzilla.data.model.CustomMenuOption
import com.kebabzilla.data.model.MenuItem
import com.kebabzilla.data.model.MenuVariation
import com.kebabzilla.databinding.DialogCustomBuilderBinding
import com.kebabzilla.databinding.DialogRepeatPromptBinding
import com.kebabzilla.databinding.DialogVariationPickerBinding
import com.kebabzilla.databinding.FragmentStorefrontBinding
import com.kebabzilla.databinding.ItemCustomOptionBinding
import com.kebabzilla.databinding.ItemCustomSectionBinding
import com.kebabzilla.databinding.ItemVariationCardBinding
import com.kebabzilla.utils.CurrencyFormatter
import kotlinx.coroutines.launch

class StorefrontFragment : Fragment() {

    private var _binding: FragmentStorefrontBinding? = null
    private val binding get() = _binding!!

    private lateinit var apiClient: ApiClient
    private lateinit var cacheManager: DataCacheManager
    private lateinit var tokenManager: TokenManager
    private lateinit var categoryAdapter: CategoryAdapter
    private lateinit var menuAdapter: MenuItemAdapter

    private var allMenuItems = listOf<MenuItem>()
    private var displayedMenuItems = listOf<MenuItem>()
    private var categories = listOf("All")
    private var selectedCategory = "All"
    private var searchQuery = ""

    private val cartListener = {
        menuAdapter.notifyDataSetChanged()
    }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentStorefrontBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        apiClient = ApiClient(requireContext())
        cacheManager = DataCacheManager(requireContext())
        tokenManager = TokenManager(requireContext())

        setupRecyclerViews()
        setupListeners()
        setupLiquidGlass()
        updateHeaderProfileInitials()

        // 1. Instantly render last known cached state (0ms latency / offline-ready)
        loadCachedData()

        // 2. Refresh from backend in background, tallying and updating only invalidated data
        fetchFreshData()

        CartManager.addListener(cartListener)
    }

    private fun setupLiquidGlass() {
        binding.layoutStorefrontGlassHeader.providerView = binding.layoutStorefrontBackdropProvider

        // Immersive status bar bleed: Glass container extends to y = 0, inner content sits safely below status icons
        ViewCompat.setOnApplyWindowInsetsListener(binding.root) { _, insets ->
            val statusBarHeight = insets.getInsets(WindowInsetsCompat.Type.statusBars()).top
            binding.layoutStorefrontHeader.setPadding(
                binding.layoutStorefrontHeader.paddingStart,
                statusBarHeight + (8 * resources.displayMetrics.density).toInt(),
                binding.layoutStorefrontHeader.paddingEnd,
                (12 * resources.displayMetrics.density).toInt()
            )
            insets
        }

        binding.layoutStorefrontGlassHeader.doOnLayout { header ->
            val headerHeight = header.height
            val spacingTop = headerHeight + (8 * resources.displayMetrics.density).toInt()
            binding.rvMenu.setPadding(
                binding.rvMenu.paddingStart,
                spacingTop,
                binding.rvMenu.paddingEnd,
                binding.rvMenu.paddingBottom
            )
            binding.layoutEmpty.setPadding(
                binding.layoutEmpty.paddingStart,
                spacingTop,
                binding.layoutEmpty.paddingEnd,
                binding.layoutEmpty.paddingBottom
            )
            binding.swipeRefresh.setProgressViewOffset(
                false,
                headerHeight,
                headerHeight + (64 * resources.displayMetrics.density).toInt()
            )
        }

        binding.rvMenu.addOnScrollListener(object : RecyclerView.OnScrollListener() {
            override fun onScrolled(recyclerView: RecyclerView, dx: Int, dy: Int) {
                binding.layoutStorefrontGlassHeader.invalidate()
            }
        })
    }

    private fun updateHeaderProfileInitials() {
        val name = tokenManager.getUserName()
        val email = tokenManager.getUserEmail()
        val initials = getInitials(name, email)
        binding.tvHeaderInitials.text = initials
    }

    private fun getInitials(name: String?, email: String?): String {
        val cleanName = name?.trim()
        if (!cleanName.isNullOrEmpty() && !cleanName.equals("Customer", ignoreCase = true)) {
            val parts = cleanName.split("\\s+".toRegex()).filter { it.isNotEmpty() }
            return when {
                parts.size >= 2 -> "${parts[0].first().uppercaseChar()}${parts[1].first().uppercaseChar()}"
                parts.size == 1 && parts[0].length >= 2 -> parts[0].take(2).uppercase()
                parts.size == 1 -> parts[0].take(1).uppercase()
                else -> "KZ"
            }
        }
        val cleanEmail = email?.trim()
        if (!cleanEmail.isNullOrEmpty()) {
            val username = cleanEmail.substringBefore('@')
            return if (username.length >= 2) username.take(2).uppercase() else username.uppercase()
        }
        return "KZ"
    }

    override fun onResume() {
        super.onResume()
        updateHeaderProfileInitials()
        // Check for any remote cart changes from website/other sessions
        CartManager.syncFromRemote()
    }

    override fun onDestroyView() {
        super.onDestroyView()
        CartManager.removeListener(cartListener)
        _binding = null
    }

    private fun setupRecyclerViews() {
        // Categories
        categoryAdapter = CategoryAdapter(categories, selectedCategory) { category ->
            selectedCategory = category
            filterMenu()
        }
        binding.rvCategories.apply {
            layoutManager = LinearLayoutManager(context, LinearLayoutManager.HORIZONTAL, false)
            adapter = categoryAdapter
        }

        // Menu items in single-column rich card feed (as designed in Stitch)
        menuAdapter = MenuItemAdapter(
            items = displayedMenuItems,
            onAddClick = { item -> handleAddItem(item) },
            onPlusClick = { item -> handleIncrementItem(item) },
            onMinusClick = { item -> handleDecrementItem(item) }
        )
        binding.rvMenu.apply {
            layoutManager = LinearLayoutManager(context)
            adapter = menuAdapter
        }
    }

    private fun setupListeners() {
        binding.swipeRefresh.setOnRefreshListener {
            fetchFreshData()
        }

        binding.etSearch.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {
                searchQuery = s?.toString()?.trim().orEmpty()
                binding.btnClearSearch.visibility = if (searchQuery.isNotEmpty()) View.VISIBLE else View.GONE
                filterMenu()
            }
            override fun afterTextChanged(s: Editable?) {}
        })

        binding.btnClearSearch.setOnClickListener {
            binding.etSearch.setText("")
        }

        binding.btnHeaderProfile.setOnClickListener {
            (activity as? MainActivity)?.showProfile()
        }
    }

    private fun loadCachedData() {
        // 1. Cached restaurant status
        val cachedStatusText = cacheManager.getCachedRestaurantStatusText()
        if (cachedStatusText != null) {
            binding.tvStoreStatusHeading.text = cachedStatusText.first
            binding.tvStoreStatusMessage.text = cachedStatusText.second
            menuAdapter.setStoreStatus(
                cacheManager.getCachedRestaurantIsOpen(),
                cacheManager.getCachedRestaurantIsDeliveryOpen()
            )
        }

        // 2. Cached menu items
        val cachedItems = cacheManager.getCachedMenuItems { apiClient.resolveImageUrl(it) }
        if (!cachedItems.isNullOrEmpty()) {
            allMenuItems = cachedItems
            extractCategories()
            filterMenu()
            binding.progressBar.visibility = View.GONE
            binding.layoutEmpty.visibility = View.GONE
        } else {
            // First run on clean install: show spinner until network response
            binding.progressBar.visibility = View.VISIBLE
        }
    }

    private fun fetchFreshData() {
        viewLifecycleOwner.lifecycleScope.launch {
            // Fetch restaurant status
            var isRestaurantOpen = true
            var isDeliveryOpen = true

            val restaurantResult = apiClient.getRestaurantInfo()
            if (restaurantResult is NetworkResult.Success) {
                val info = restaurantResult.data
                isRestaurantOpen = info.isRestaurantOpen
                isDeliveryOpen = info.isDeliveryOpen

                val isPastCutoff = info.cutoffInMinutes != null && info.cutoffInMinutes <= 0
                val effectiveDeliveryOpen = isDeliveryOpen && !isPastCutoff
                val isApproachingClosing = (info.closingInMinutes != null && info.closingInMinutes > 0 && info.closingInMinutes <= 30) ||
                        (info.cutoffInMinutes != null && info.cutoffInMinutes > 0 && info.cutoffInMinutes <= 15)

                val heading: String
                val message: String

                if (!isRestaurantOpen) {
                    heading = "Sorry, we are closed"
                    message = "Our shop is currently closed. Please check back during operating hours."
                } else if (!effectiveDeliveryOpen) {
                    heading = info.deliveryStatusHeading?.takeIf { it.isNotBlank() } ?: "Delivery is currently unavailable"
                    message = if (info.closingInMinutes != null && info.closingInMinutes > 0 && info.closingInMinutes <= 59) {
                        "Our shop is open! We are currently only accepting walk-in orders at our counter. The restaurant is closing in ${info.closingInMinutes} minutes."
                    } else {
                        "Our shop is open! We are currently only accepting walk-in orders at our counter."
                    }
                } else if (isApproachingClosing) {
                    heading = "Hurry up closing soon"
                    val mins = info.cutoffInMinutes ?: info.closingInMinutes ?: 15
                    message = "The restaurant is closing in $mins minutes."
                } else {
                    heading = info.deliveryStatusHeading?.takeIf { it.isNotBlank() } ?: "Menu"
                    message = info.deliveryStatusMessage?.takeIf { it.isNotBlank() } ?: "Choose what you’d like to order."
                }

                // Tally: Only update and re-render if data has changed/invalidated
                val currentHeading = binding.tvStoreStatusHeading.text.toString()
                val currentMessage = binding.tvStoreStatusMessage.text.toString()
                if (currentHeading != heading || currentMessage != message) {
                    binding.tvStoreStatusHeading.text = heading
                    binding.tvStoreStatusMessage.text = message
                }
                menuAdapter.setStoreStatus(isRestaurantOpen, isDeliveryOpen)

                // Update cache with computed heading & message
                cacheManager.saveRestaurantState(info, "", heading, message)
            }

            // Fetch menu (combined standard and custom customizable menu items)
            val menuResult = apiClient.getAllMenuItemsCombined()
            binding.progressBar.visibility = View.GONE
            binding.swipeRefresh.isRefreshing = false

            when (menuResult) {
                is NetworkResult.Success -> {
                    val freshItems = menuResult.data
                    // Tally: Check if menu data has invalidated (items changed, added, removed, paused, or prices updated)
                    if (allMenuItems != freshItems) {
                        allMenuItems = freshItems
                        extractCategories()
                        filterMenu()
                        CartManager.refreshMenuItemDetails(freshItems)
                    }
                }
                is NetworkResult.Error -> {
                    if (allMenuItems.isEmpty()) {
                        binding.layoutEmpty.visibility = View.VISIBLE
                        binding.tvEmptyMessage.text = "${menuResult.message}\nSwipe down to retry."
                    } else {
                        // Smooth fallback: keep showing cached menu
                        Toast.makeText(requireContext(), "Showing cached menu", Toast.LENGTH_SHORT).show()
                    }
                }
                is NetworkResult.Loading -> {}
            }
        }
    }

    private fun extractCategories() {
        val set = linkedSetOf("All", "Veg")
        for (item in allMenuItems) {
            if (item.category.isNotBlank() && !item.category.equals("All", ignoreCase = true) && !item.category.equals("Veg", ignoreCase = true)) {
                set.add(item.category)
            }
            for (c in item.categories) {
                if (c.isNotBlank() && !c.equals("All", ignoreCase = true) && !c.equals("Veg", ignoreCase = true)) {
                    set.add(c)
                }
            }
        }
        categories = set.toList()
        categoryAdapter.updateCategories(categories, selectedCategory)
    }

    private fun filterMenu() {
        val filtered = allMenuItems.filter { item ->
            val matchesCategory = when {
                selectedCategory.equals("All", ignoreCase = true) -> true
                selectedCategory.equals("Veg", ignoreCase = true) -> item.isVegetarian
                else -> item.category.equals(selectedCategory, ignoreCase = true) ||
                        item.categories.any { it.equals(selectedCategory, ignoreCase = true) }
            }

            val matchesSearch = searchQuery.isEmpty() ||
                    item.name.contains(searchQuery, ignoreCase = true) ||
                    (item.description?.contains(searchQuery, ignoreCase = true) == true)

            matchesCategory && matchesSearch
        }

        displayedMenuItems = filtered
        menuAdapter.updateList(displayedMenuItems)

        if (displayedMenuItems.isEmpty()) {
            binding.layoutEmpty.visibility = View.VISIBLE
            binding.tvEmptyMessage.text = "No kebabs found matching your criteria."
        } else {
            binding.layoutEmpty.visibility = View.GONE
        }
    }

    private fun handleAddItem(item: MenuItem) {
        if (menuAdapter.isOrderingClosed || item.isPaused || !item.isAvailable) {
            Toast.makeText(requireContext(), "Ordering is currently unavailable", Toast.LENGTH_SHORT).show()
            return
        }

        when {
            item.isCustomizable -> {
                if (CartManager.hasItem(item.id)) {
                    showRepeatPromptDialog(item, isVariation = false)
                } else {
                    showCustomBuilderDialog(item)
                }
            }
            item.hasVariations -> {
                if (CartManager.hasItem(item.id)) {
                    showRepeatPromptDialog(item, isVariation = true)
                } else {
                    showVariationDialog(item)
                }
            }
            else -> {
                CartManager.addItem(item, null, 1)
            }
        }
    }

    private fun handleIncrementItem(item: MenuItem) {
        handleAddItem(item)
    }

    private fun handleDecrementItem(item: MenuItem) {
        val cartLines = CartManager.getLinesForMenuItem(item.id)
        if (cartLines.isNotEmpty()) {
            val lastLine = cartLines.last()
            CartManager.updateQuantity(lastLine.lineKey, lastLine.quantity - 1)
        }
    }

    private fun showVariationDialog(item: MenuItem) {
        val dialog = BottomSheetDialog(requireContext())
        val dialogBinding = DialogVariationPickerBinding.inflate(layoutInflater)
        dialog.setContentView(dialogBinding.root)

        dialogBinding.tvSheetEyebrow.text = item.variationEyebrow
        dialogBinding.tvSheetFoodName.text = "Select ${item.variationNoun} for ${item.name}"
        dialogBinding.btnClose.setOnClickListener { dialog.dismiss() }

        var selectedVariation: MenuVariation? = item.variations.find { it.isDefault } ?: item.variations.firstOrNull()

        fun calculatePrice(variation: MenuVariation): Long {
            val disc = item.discountPercent
            return if (disc > 0) {
                Math.round((variation.pricePaise * (100 - disc)) / 100.0).toLong()
            } else {
                variation.pricePaise
            }
        }

        fun updateUI() {
            dialogBinding.llVariationOptions.removeAllViews()

            val disc = item.discountPercent
            item.variations.forEach { variation ->
                val cardBinding = ItemVariationCardBinding.inflate(layoutInflater, dialogBinding.llVariationOptions, false)
                val isSelected = selectedVariation?.name == variation.name

                val discountedPrice = calculatePrice(variation)

                cardBinding.tvVariationName.text = variation.name
                cardBinding.tvVariationPrice.text = CurrencyFormatter.formatPaise(discountedPrice)

                if (disc > 0) {
                    cardBinding.tvOriginalPrice.visibility = View.VISIBLE
                    cardBinding.tvOriginalPrice.text = CurrencyFormatter.formatPaise(variation.pricePaise)
                    cardBinding.tvOriginalPrice.paintFlags = cardBinding.tvOriginalPrice.paintFlags or Paint.STRIKE_THRU_TEXT_FLAG
                } else {
                    cardBinding.tvOriginalPrice.visibility = View.GONE
                }

                if (isSelected) {
                    cardBinding.layoutVariationCard.setBackgroundResource(R.drawable.bg_option_selected)
                    cardBinding.ivRadioDot.setImageResource(R.drawable.ic_radio_dot_checked)
                    cardBinding.tvVariationName.setTextColor(ContextCompat.getColor(requireContext(), R.color.brand_ink))
                    cardBinding.tvVariationPrice.setTextColor(ContextCompat.getColor(requireContext(), R.color.brand_ink))
                } else {
                    cardBinding.layoutVariationCard.setBackgroundResource(R.drawable.bg_option_unselected)
                    cardBinding.ivRadioDot.setImageResource(R.drawable.ic_radio_dot_unchecked)
                    cardBinding.tvVariationName.setTextColor(ContextCompat.getColor(requireContext(), R.color.brand_ink))
                    cardBinding.tvVariationPrice.setTextColor(ContextCompat.getColor(requireContext(), R.color.brand_ink))
                }

                cardBinding.layoutVariationCard.setOnClickListener {
                    selectedVariation = variation
                    updateUI()
                }

                dialogBinding.llVariationOptions.addView(cardBinding.root)
            }

            val activeVar = selectedVariation ?: item.variations.firstOrNull()
            val totalPaise = if (activeVar != null) calculatePrice(activeVar) else item.displayPricePaise
            dialogBinding.tvSheetTotalPrice.text = CurrencyFormatter.formatPaise(totalPaise)
        }

        updateUI()

        dialogBinding.btnAddToCart.setOnClickListener {
            val chosen = selectedVariation ?: item.variations.firstOrNull()
            if (chosen != null) {
                val finalPrice = calculatePrice(chosen)
                CartManager.addItem(
                    item = item,
                    variationName = chosen.name,
                    quantity = 1,
                    customUnitPricePaise = finalPrice
                )
            }
            dialog.dismiss()
        }

        dialog.show()
    }

    private fun showCustomBuilderDialog(item: MenuItem) {
        val dialog = BottomSheetDialog(requireContext())
        val dialogBinding = DialogCustomBuilderBinding.inflate(layoutInflater)
        dialog.setContentView(dialogBinding.root)

        dialogBinding.tvCustomFoodName.text = "Customize ${item.name}"
        dialogBinding.btnClose.setOnClickListener { dialog.dismiss() }

        // Map of sectionName -> selected CustomMenuOption
        val selectedOptions = mutableMapOf<String, CustomMenuOption>()

        // Initialize defaults
        item.customSections.forEach { section ->
            val defaultOpt = section.options.find { it.isDefault }
                ?: if (section.required && section.options.isNotEmpty()) section.options[0] else null
            if (defaultOpt != null) {
                selectedOptions[section.name] = defaultOpt
            }
        }

        fun calculateUnitPrice(): Long {
            val base = if (item.basePricePaise > 0) item.basePricePaise else item.pricePaise
            val extra = selectedOptions.values.sumOf { it.extraPaise }
            val raw = base + extra
            val disc = item.discountPercent
            return if (disc > 0) {
                Math.round((raw * (100 - disc)) / 100.0).toLong()
            } else {
                raw
            }
        }

        fun updateUI() {
            dialogBinding.llCustomSections.removeAllViews()

            item.customSections.forEach { section ->
                val sectionBinding = ItemCustomSectionBinding.inflate(layoutInflater, dialogBinding.llCustomSections, false)
                sectionBinding.tvSectionName.text = section.name

                if (section.required) {
                    sectionBinding.tvSectionTag.text = "REQUIRED"
                    sectionBinding.tvSectionTag.setBackgroundResource(R.drawable.bg_tag_required)
                    sectionBinding.tvSectionTag.setTextColor(ContextCompat.getColor(requireContext(), R.color.brand_red))
                } else {
                    sectionBinding.tvSectionTag.text = "OPTIONAL"
                    sectionBinding.tvSectionTag.setBackgroundResource(R.drawable.bg_tag_optional)
                    sectionBinding.tvSectionTag.setTextColor(ContextCompat.getColor(requireContext(), R.color.brand_green))
                }

                section.options.forEach { opt ->
                    val optBinding = ItemCustomOptionBinding.inflate(layoutInflater, sectionBinding.llSectionOptions, false)
                    val isSelected = selectedOptions[section.name]?.name == opt.name

                    optBinding.tvOptionName.text = opt.name
                    optBinding.tvOptionPrice.text = if (opt.extraPaise > 0) {
                        "+${CurrencyFormatter.formatPaise(opt.extraPaise)}"
                    } else {
                        "Free"
                    }

                    if (isSelected) {
                        optBinding.layoutOptionCard.setBackgroundResource(R.drawable.bg_option_selected)
                        optBinding.ivOptionRadio.setImageResource(R.drawable.ic_radio_dot_checked)
                        optBinding.tvOptionName.setTextColor(ContextCompat.getColor(requireContext(), R.color.brand_ink))
                    } else {
                        optBinding.layoutOptionCard.setBackgroundResource(R.drawable.bg_option_unselected)
                        optBinding.ivOptionRadio.setImageResource(R.drawable.ic_radio_dot_unchecked)
                        optBinding.tvOptionName.setTextColor(ContextCompat.getColor(requireContext(), R.color.brand_ink))
                    }

                    optBinding.layoutOptionCard.setOnClickListener {
                        if (isSelected && !section.required) {
                            selectedOptions.remove(section.name)
                        } else {
                            selectedOptions[section.name] = opt
                        }
                        updateUI()
                    }

                    sectionBinding.llSectionOptions.addView(optBinding.root)
                }

                dialogBinding.llCustomSections.addView(sectionBinding.root)
            }

            val totalPaise = calculateUnitPrice()
            dialogBinding.tvCustomTotalPrice.text = CurrencyFormatter.formatPaise(totalPaise)
        }

        updateUI()

        dialogBinding.btnCustomAddToCart.setOnClickListener {
            // Validate required sections
            for (sec in item.customSections) {
                if (sec.required && (selectedOptions[sec.name] == null)) {
                    Toast.makeText(requireContext(), "Please select an option for ${sec.name}", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }
            }

            val chosenOptions = selectedOptions.values.toList()
            val summaryName = if (chosenOptions.isNotEmpty()) {
                chosenOptions.joinToString(", ") { it.name }
            } else {
                "Custom"
            }
            val finalPrice = calculateUnitPrice()

            CartManager.addItem(
                item = item,
                variationName = summaryName,
                quantity = 1,
                customUnitPricePaise = finalPrice
            )
            dialog.dismiss()
        }

        dialog.show()
    }

    private fun showRepeatPromptDialog(item: MenuItem, isVariation: Boolean) {
        val dialog = BottomSheetDialog(requireContext())
        val dialogBinding = DialogRepeatPromptBinding.inflate(layoutInflater)
        dialog.setContentView(dialogBinding.root)

        val lastLine = CartManager.getLastLineForMenuItem(item.id)

        if (isVariation) {
            dialogBinding.tvRepeatEyebrow.text = item.variationEyebrow
            dialogBinding.tvRepeatTitle.text = "Repeat last ${item.variationNoun}?"
        } else {
            dialogBinding.tvRepeatEyebrow.text = "CUSTOMIZATION"
            dialogBinding.tvRepeatTitle.text = "Repeat last customization?"
        }

        val summaryText = if (!lastLine?.variationName.isNullOrBlank()) {
            "${lastLine!!.variationName} (${CurrencyFormatter.formatPaise(lastLine.unitPricePaise)})"
        } else {
            CurrencyFormatter.formatPaise(lastLine?.unitPricePaise ?: item.displayPricePaise)
        }
        dialogBinding.tvRepeatSummary.text = summaryText

        dialogBinding.btnClose.setOnClickListener {
            dialog.dismiss()
        }

        dialogBinding.btnChooseAnother.setOnClickListener {
            dialog.dismiss()
            if (isVariation) {
                showVariationDialog(item)
            } else {
                showCustomBuilderDialog(item)
            }
        }

        dialogBinding.btnRepeatLast.setOnClickListener {
            dialog.dismiss()
            if (lastLine != null) {
                CartManager.addItem(
                    item = item,
                    variationName = lastLine.variationName,
                    quantity = 1,
                    customUnitPricePaise = lastLine.unitPricePaise
                )
            } else {
                if (isVariation) {
                    showVariationDialog(item)
                } else {
                    showCustomBuilderDialog(item)
                }
            }
        }

        dialog.show()
    }
}
