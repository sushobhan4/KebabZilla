package com.kebabzilla.ui.workspace

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.LinearLayoutManager
import com.kebabzilla.MainActivity
import com.kebabzilla.R
import com.kebabzilla.data.api.ApiClient
import com.kebabzilla.data.api.NetworkResult
import com.kebabzilla.data.local.TokenManager
import com.kebabzilla.databinding.FragmentWorkspaceBinding
import com.kebabzilla.utils.Constants
import com.kebabzilla.utils.CurrencyFormatter
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import java.util.Calendar

class WorkspaceFragment : Fragment() {

    private var _binding: FragmentWorkspaceBinding? = null
    private val binding get() = _binding!!

    private lateinit var apiClient: ApiClient
    private lateinit var tokenManager: TokenManager
    private lateinit var tabAdapter: WorkspaceTabAdapter

    private var isGridView = true
    private val tabsList = mutableListOf<WorkspaceTabItem>()

    companion object {
        private const val PREF_WORKSPACE_VIEW_MODE = "pref_workspace_view_mode"
        private const val VIEW_MODE_GRID = "GRID"
        private const val VIEW_MODE_LIST = "LIST"
    }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentWorkspaceBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        apiClient = ApiClient(requireContext())
        tokenManager = TokenManager(requireContext())

        val prefs = requireContext().getSharedPreferences(Constants.PREFS_NAME, Context.MODE_PRIVATE)
        isGridView = prefs.getString(PREF_WORKSPACE_VIEW_MODE, VIEW_MODE_GRID) != VIEW_MODE_LIST

        setupGreeting()
        setupHeaderButtons()
        buildTabsList()
        setupRecyclerView()
        refreshLiveMetrics()

        binding.swipeWorkspace.setOnRefreshListener {
            refreshLiveMetrics()
        }
    }

    override fun onResume() {
        super.onResume()
        setupGreeting()
        binding.tvWorkspaceRoleBadge.text = tokenManager.getUserRole().uppercase()
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }

    private fun setupGreeting() {
        val hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
        val greeting = when {
            hour in 4..11 -> "Good morning."
            hour in 12..16 -> "Good afternoon."
            hour in 17..21 -> "Good evening."
            else -> "Good night."
        }
        binding.tvWorkspaceGreeting.text = greeting
    }

    private fun setupHeaderButtons() {
        // Red Circular Profile Avatar button in top-right
        binding.btnWorkspaceProfile.setOnClickListener {
            (activity as? MainActivity)?.showProfile()
        }

        // View Switcher Buttons
        binding.btnViewGrid.setOnClickListener {
            if (!isGridView) {
                isGridView = true
                saveViewPreference(VIEW_MODE_GRID)
                updateViewSwitcherUI()
                applyLayoutManager()
            }
        }

        binding.btnViewList.setOnClickListener {
            if (isGridView) {
                isGridView = false
                saveViewPreference(VIEW_MODE_LIST)
                updateViewSwitcherUI()
                applyLayoutManager()
            }
        }

        updateViewSwitcherUI()
    }

    private fun saveViewPreference(mode: String) {
        val prefs = requireContext().getSharedPreferences(Constants.PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(PREF_WORKSPACE_VIEW_MODE, mode).apply()
    }

    private fun updateViewSwitcherUI() {
        if (isGridView) {
            binding.btnViewGrid.background = ContextCompat.getDrawable(requireContext(), R.drawable.bg_pill_primary)
            binding.ivViewGridIcon.setColorFilter(ContextCompat.getColor(requireContext(), R.color.white))
            binding.btnViewList.background = null
            binding.ivViewListIcon.setColorFilter(ContextCompat.getColor(requireContext(), R.color.brand_muted))
        } else {
            binding.btnViewList.background = ContextCompat.getDrawable(requireContext(), R.drawable.bg_pill_primary)
            binding.ivViewListIcon.setColorFilter(ContextCompat.getColor(requireContext(), R.color.white))
            binding.btnViewGrid.background = null
            binding.ivViewGridIcon.setColorFilter(ContextCompat.getColor(requireContext(), R.color.brand_muted))
        }
    }

    private fun buildTabsList() {
        tabsList.clear()
        // 1. Overview
        tabsList.add(
            WorkspaceTabItem(
                key = WorkspaceTabAdapter.TAB_OVERVIEW,
                title = "Overview",
                subtitle = "Real-time KPI overview & master metrics",
                iconRes = R.drawable.ic_grid_view,
                badgeText = "Live",
                tone = WorkspaceCardTone.DEFAULT
            )
        )
        // 2. Order
        tabsList.add(
            WorkspaceTabItem(
                key = WorkspaceTabAdapter.TAB_ORDER,
                title = "Order",
                subtitle = "Master orders table, status & refunds",
                iconRes = R.drawable.ic_receipt_long,
                badgeText = "6 Active",
                tone = WorkspaceCardTone.DEFAULT
            )
        )
        // 3. Menu
        tabsList.add(
            WorkspaceTabItem(
                key = WorkspaceTabAdapter.TAB_MENU,
                title = "Menu",
                subtitle = "Catalog variations, stock & pause toggle",
                iconRes = R.drawable.ic_restaurant_menu,
                badgeText = "32 items",
                tone = WorkspaceCardTone.DEFAULT
            )
        )
        // 4. People
        tabsList.add(
            WorkspaceTabItem(
                key = WorkspaceTabAdapter.TAB_PEOPLE,
                title = "People",
                subtitle = "Team roster, shift roles & rider staff",
                iconRes = R.drawable.ic_people,
                badgeText = "12 Staff",
                tone = WorkspaceCardTone.DEFAULT
            )
        )
        // 5. Activity
        tabsList.add(
            WorkspaceTabItem(
                key = WorkspaceTabAdapter.TAB_ACTIVITY,
                title = "Activity",
                subtitle = "System audit trail & recent status logs",
                iconRes = R.drawable.ic_clock,
                badgeText = "Audit",
                tone = WorkspaceCardTone.DEFAULT
            )
        )
        // 6. Broadcast
        tabsList.add(
            WorkspaceTabItem(
                key = WorkspaceTabAdapter.TAB_BROADCAST,
                title = "Broadcast",
                subtitle = "Push alerts & emergency flash alerts",
                iconRes = R.drawable.ic_campaign,
                badgeText = "Marketing",
                tone = WorkspaceCardTone.DEFAULT
            )
        )
        // 7. Discount
        tabsList.add(
            WorkspaceTabItem(
                key = WorkspaceTabAdapter.TAB_DISCOUNT,
                title = "Discount",
                subtitle = "Promo coupons, % off & flat discounts",
                iconRes = R.drawable.ic_percent,
                badgeText = "3 Active",
                tone = WorkspaceCardTone.DEFAULT
            )
        )
        // 8. Order queue
        tabsList.add(
            WorkspaceTabItem(
                key = WorkspaceTabAdapter.TAB_ORDER_QUEUE,
                title = "Order queue",
                subtitle = "Live KDS tickets & grill station flow",
                iconRes = R.drawable.ic_cooking_pot,
                badgeText = "4 Grill",
                tone = WorkspaceCardTone.GREEN
            )
        )
        // 9. Walk-in-billing
        tabsList.add(
            WorkspaceTabItem(
                key = WorkspaceTabAdapter.TAB_BILLING,
                title = "Walk-in-billing",
                subtitle = "Counter POS register & quick receipts",
                iconRes = R.drawable.ic_point_of_sale,
                badgeText = "POS",
                tone = WorkspaceCardTone.GREEN
            )
        )
        // 10. Menu availability
        tabsList.add(
            WorkspaceTabItem(
                key = WorkspaceTabAdapter.TAB_MENU_AVAILABILITY,
                title = "Menu availability",
                subtitle = "Real-time 86 list, pause items & daily stock...",
                iconRes = R.drawable.ic_toggle_check,
                badgeText = "Stock On/Off",
                tone = WorkspaceCardTone.GREEN
            )
        )
        // 11. Delivery queue
        tabsList.add(
            WorkspaceTabItem(
                key = WorkspaceTabAdapter.TAB_DELIVERY_QUEUE,
                title = "Delivery queue",
                subtitle = "ALNS batching, rider routes & live GPS",
                iconRes = R.drawable.ic_two_wheeler,
                badgeText = "6 Riders",
                tone = WorkspaceCardTone.AMBER
            )
        )
        // 12. Sales reports
        tabsList.add(
            WorkspaceTabItem(
                key = WorkspaceTabAdapter.TAB_REPORTS,
                title = "Sales reports",
                subtitle = "Daily revenue, GST & shift analytics",
                iconRes = R.drawable.ic_analytics,
                badgeText = "Settled",
                tone = WorkspaceCardTone.PLUM
            )
        )
        // 13. Restaurant settings (spans 2 columns in Grid View)
        tabsList.add(
            WorkspaceTabItem(
                key = WorkspaceTabAdapter.TAB_SETTINGS,
                title = "Restaurant settings",
                subtitle = "Store hours, geofence & payment rails",
                iconRes = R.drawable.ic_store_settings,
                badgeText = "Store #01",
                tone = WorkspaceCardTone.DEFAULT,
                fullWidth = true
            )
        )
    }

    private fun setupRecyclerView() {
        tabAdapter = WorkspaceTabAdapter(
            items = tabsList,
            isGridView = isGridView
        ) { clickedItem ->
            val intent = Intent(requireContext(), WorkspaceTabActivity::class.java).apply {
                putExtra(WorkspaceTabActivity.EXTRA_TAB_KEY, clickedItem.key)
                putExtra(WorkspaceTabActivity.EXTRA_TAB_TITLE, clickedItem.title)
            }
            startActivity(intent)
        }

        binding.rvWorkspaceTabs.adapter = tabAdapter
        applyLayoutManager()
    }

    private fun applyLayoutManager() {
        tabAdapter.setGridView(isGridView)
        if (isGridView) {
            val gridLayoutManager = GridLayoutManager(requireContext(), 2)
            gridLayoutManager.spanSizeLookup = object : GridLayoutManager.SpanSizeLookup() {
                override fun getSpanSize(position: Int): Int {
                    return if (position in tabsList.indices && tabsList[position].fullWidth) 2 else 1
                }
            }
            binding.rvWorkspaceTabs.layoutManager = gridLayoutManager
        } else {
            binding.rvWorkspaceTabs.layoutManager = LinearLayoutManager(requireContext())
        }
    }

    private fun refreshLiveMetrics() {
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val ordersDeferred = async { apiClient.getStaffOrders() }
                val menuDeferred = async { apiClient.getAllMenuItemsCombined() }
                val accountsDeferred = async { apiClient.getAdminAccounts(true) }
                val discountsDeferred = async { apiClient.getDiscounts() }
                val settingsDeferred = async { apiClient.getAdminSettings() }
                val salesDeferred = async { apiClient.getSalesReport("today") }

                val ordersResult = ordersDeferred.await()
                if (ordersResult is NetworkResult.Success) {
                    val orders = ordersResult.data
                    val activeCount = orders.count { it.status in listOf("PLACED", "ACCEPTED", "PREPARING", "READY") }
                    val grillCount = orders.count { it.status in listOf("ACCEPTED", "PREPARING") }
                    val deliveryCount = orders.count { it.status in listOf("READY", "OUT_FOR_DELIVERY") }
                    updateTabBadge(WorkspaceTabAdapter.TAB_ORDER, "$activeCount Active")
                    updateTabBadge(WorkspaceTabAdapter.TAB_ORDER_QUEUE, "$grillCount Grill")
                    updateTabBadge(WorkspaceTabAdapter.TAB_DELIVERY_QUEUE, "$deliveryCount Active")
                }

                val menuResult = menuDeferred.await()
                if (menuResult is NetworkResult.Success) {
                    updateTabBadge(WorkspaceTabAdapter.TAB_MENU, "${menuResult.data.size} items")
                }

                val accountsResult = accountsDeferred.await()
                if (accountsResult is NetworkResult.Success) {
                    updateTabBadge(WorkspaceTabAdapter.TAB_PEOPLE, "${accountsResult.data.size} Staff")
                }

                val discountsResult = discountsDeferred.await()
                if (discountsResult is NetworkResult.Success) {
                    val activeDiscounts = discountsResult.data.count { it.isActive }
                    updateTabBadge(WorkspaceTabAdapter.TAB_DISCOUNT, "$activeDiscounts Active")
                }

                val settingsResult = settingsDeferred.await()
                if (settingsResult is NetworkResult.Success) {
                    val statusText = if (settingsResult.data.isOpen) "Open" else "Closed"
                    updateTabBadge(WorkspaceTabAdapter.TAB_SETTINGS, "Store #01 · $statusText")
                }

                val salesResult = salesDeferred.await()
                if (salesResult is NetworkResult.Success) {
                    val rev = CurrencyFormatter.formatPaise(salesResult.data.revenuePaise)
                    updateTabBadge(WorkspaceTabAdapter.TAB_OVERVIEW, rev)
                    updateTabBadge(WorkspaceTabAdapter.TAB_REPORTS, rev)
                }
            } catch (_: Exception) {
            } finally {
                binding.swipeWorkspace.isRefreshing = false
                tabAdapter.notifyDataSetChanged()
            }
        }
    }

    private fun updateTabBadge(key: String, badge: String) {
        val tab = tabsList.firstOrNull { it.key == key }
        if (tab != null) {
            tab.badgeText = badge
        }
    }
}
