package com.kebabzilla.ui.workspace

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.widget.doAfterTextChanged
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import coil.load
import com.google.android.material.button.MaterialButton
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import androidx.appcompat.widget.SwitchCompat
import com.kebabzilla.R
import com.kebabzilla.data.api.ApiClient
import com.kebabzilla.data.api.NetworkResult
import com.kebabzilla.data.model.*
import com.kebabzilla.databinding.*
import com.kebabzilla.utils.CurrencyFormatter
import kotlinx.coroutines.async
import kotlinx.coroutines.launch

class WorkspaceTabActivity : AppCompatActivity() {

    private lateinit var binding: ActivityWorkspaceTabBinding
    private lateinit var apiClient: ApiClient

    private var activeTabKey = WorkspaceTabAdapter.TAB_OVERVIEW
    private var initialStatusFilter: String? = null

    companion object {
        const val EXTRA_TAB_KEY = "extra_tab_key"
        const val EXTRA_TAB_TITLE = "extra_tab_title"
        const val EXTRA_STATUS_FILTER = "extra_status_filter"

        fun start(context: Context, tabKey: String, title: String? = null, statusFilter: String? = null) {
            val intent = Intent(context, WorkspaceTabActivity::class.java).apply {
                putExtra(EXTRA_TAB_KEY, tabKey)
                if (title != null) putExtra(EXTRA_TAB_TITLE, title)
                if (statusFilter != null) putExtra(EXTRA_STATUS_FILTER, statusFilter)
            }
            context.startActivity(intent)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)

        val insetsController = WindowCompat.getInsetsController(window, window.decorView)
        insetsController.isAppearanceLightStatusBars = true
        insetsController.isAppearanceLightNavigationBars = true

        binding = ActivityWorkspaceTabBinding.inflate(layoutInflater)
        setContentView(binding.root)

        ViewCompat.setOnApplyWindowInsetsListener(binding.root) { _, insets ->
            val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            val density = resources.displayMetrics.density
            val topPadding = systemBars.top + (8 * density).toInt()
            val bottomPadding = systemBars.bottom + (8 * density).toInt()
            binding.layoutTabTopBar.setPadding(
                binding.layoutTabTopBar.paddingLeft,
                topPadding,
                binding.layoutTabTopBar.paddingRight,
                binding.layoutTabTopBar.paddingBottom
            )
            binding.frameTabContent.setPadding(
                binding.frameTabContent.paddingLeft,
                binding.frameTabContent.paddingTop,
                binding.frameTabContent.paddingRight,
                bottomPadding
            )
            insets
        }

        apiClient = ApiClient(this)
        activeTabKey = intent.getStringExtra(EXTRA_TAB_KEY) ?: WorkspaceTabAdapter.TAB_OVERVIEW
        initialStatusFilter = intent.getStringExtra(EXTRA_STATUS_FILTER)

        binding.btnTabBack.setOnClickListener {
            finish()
        }

        renderTab()
    }

    private fun setLoading(isLoading: Boolean) {
        binding.progressTabLoading.visibility = if (isLoading) View.VISIBLE else View.GONE
    }

    private fun setupTopActionButton(iconRes: Int, onClick: () -> Unit) {
        binding.btnTabAction.visibility = View.VISIBLE
        binding.ivTabActionIcon.setImageResource(iconRes)
        binding.btnTabAction.setOnClickListener { onClick() }
    }

    private fun hideTopActionButton() {
        binding.btnTabAction.visibility = View.GONE
        binding.btnTabAction.setOnClickListener(null)
    }

    private fun renderTab() {
        binding.frameTabContent.removeAllViews()
        when (activeTabKey) {
            WorkspaceTabAdapter.TAB_OVERVIEW -> renderOverviewTab()
            WorkspaceTabAdapter.TAB_ORDER -> renderOrdersTab()
            WorkspaceTabAdapter.TAB_MENU -> renderMenuTab()
            WorkspaceTabAdapter.TAB_PEOPLE -> renderPeopleTab()
            WorkspaceTabAdapter.TAB_ACTIVITY -> renderActivityTab()
            WorkspaceTabAdapter.TAB_BROADCAST -> renderBroadcastTab()
            WorkspaceTabAdapter.TAB_DISCOUNT -> renderDiscountTab()
            WorkspaceTabAdapter.TAB_ORDER_QUEUE -> renderOrderQueueTab()
            WorkspaceTabAdapter.TAB_BILLING -> renderBillingTab()
            WorkspaceTabAdapter.TAB_MENU_AVAILABILITY -> renderMenuAvailabilityTab()
            WorkspaceTabAdapter.TAB_DELIVERY_QUEUE -> renderDeliveryQueueTab()
            WorkspaceTabAdapter.TAB_REPORTS -> renderReportsTab()
            WorkspaceTabAdapter.TAB_SETTINGS -> renderSettingsTab()
            else -> renderOverviewTab()
        }
    }

    private fun switchTab(tabKey: String, statusFilter: String? = null) {
        activeTabKey = tabKey
        initialStatusFilter = statusFilter
        renderTab()
    }

    private fun dpToPx(dp: Int): Int {
        return (dp * resources.displayMetrics.density).toInt()
    }

    private fun formatFriendlyDate(raw: String?): String {
        if (raw.isNullOrBlank()) return "Recently"
        return try {
            val clean = raw.replace("Z", "+0000").replace("T", " ")
            val parser = java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss", java.util.Locale.getDefault())
            val date = parser.parse(clean.substringBefore(".")) ?: return raw.take(16).replace("T", " ")
            val now = java.util.Date()
            val diffMs = now.time - date.time
            val diffMins = diffMs / (60 * 1000)
            when {
                diffMins < 1 -> "Just now"
                diffMins < 60 -> "${diffMins}m ago"
                diffMins < 1440 -> "${diffMins / 60}h ago"
                else -> {
                    val formatter = java.text.SimpleDateFormat("dd MMM, hh:mm a", java.util.Locale.getDefault())
                    formatter.format(date)
                }
            }
        } catch (e: Exception) {
            raw.take(16).replace("T", " ")
        }
    }

    private fun getFallbackSeries(): List<SalesChartPoint> {
        val days = listOf("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
        return days.map { SalesChartPoint(label = it, revenuePaise = 0L, orders = 0) }
    }

    // =========================================================================
    // 1. OVERVIEW TAB
    // =========================================================================
    private fun renderOverviewTab() {
        binding.tvTabHeaderTitle.text = "Overview"
        binding.tvTabHeaderSubtitle.visibility = View.GONE
        setupTopActionButton(R.drawable.ic_refresh) { renderOverviewTab() }

        val viewBinding = LayoutTabOverviewBinding.inflate(layoutInflater, binding.frameTabContent, true)
        setLoading(true)

        lifecycleScope.launch {
            val salesDeferred = async { apiClient.getSalesReport("week") }
            val ordersDeferred = async { apiClient.getAdminOrdersSummary(5) }
            val accountsDeferred = async { apiClient.getAdminAccountsSummary(5) }
            val settingsDeferred = async { apiClient.getAdminSettings() }
            val eventsDeferred = async { apiClient.getAdminEvents(12) }

            val salesRes = salesDeferred.await()
            val ordersRes = ordersDeferred.await()
            val accountsRes = accountsDeferred.await()
            val settingsRes = settingsDeferred.await()
            val eventsRes = eventsDeferred.await()

            setLoading(false)

            val report = (salesRes as? NetworkResult.Success)?.data
            val ordersSummary = (ordersRes as? NetworkResult.Success)?.data
            val accountsSummary = (accountsRes as? NetworkResult.Success)?.data
            val settings = (settingsRes as? NetworkResult.Success)?.data
            val events = (eventsRes as? NetworkResult.Success)?.data ?: emptyList()

            // 1. TOP KPI STATS (5 Cards)
            // Card 1: Paid Revenue
            val revenuePaise = report?.revenuePaise ?: 0L
            viewBinding.tvOverviewRevenue.text = CurrencyFormatter.formatPaise(revenuePaise)
            viewBinding.tvOverviewRevenueSalesKicker.text = "↗ Sales"
            viewBinding.cardOverviewRevenue.setOnClickListener {
                switchTab(WorkspaceTabAdapter.TAB_REPORTS)
            }

            // Card 2: Orders Recorded
            val totalOrdersCount = if (ordersSummary != null && ordersSummary.statusCounts.isNotEmpty()) {
                ordersSummary.statusCounts.values.sum()
            } else {
                report?.totalOrders ?: 0
            }
            val openOrdersCount = if (ordersSummary != null && ordersSummary.statusCounts.isNotEmpty()) {
                listOf("PLACED", "ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY").sumOf {
                    ordersSummary.statusCounts[it] ?: 0
                }
            } else {
                0
            }
            viewBinding.tvOverviewOrdersCount.text = totalOrdersCount.toString()
            viewBinding.tvOverviewActiveOrdersCount.text = "$openOrdersCount active now"
            viewBinding.cardOverviewOrders.setOnClickListener {
                switchTab(WorkspaceTabAdapter.TAB_ORDER)
            }

            // Card 3: Active Accounts
            val totalAccounts = accountsSummary?.total ?: 0
            val employeesCount = if (accountsSummary != null) {
                (accountsSummary.roleCounts["EMPLOYEE"] ?: 0) + (accountsSummary.roleCounts["STAFF"] ?: 0)
            } else {
                0
            }
            viewBinding.tvOverviewAccountsCount.text = totalAccounts.toString()
            viewBinding.tvOverviewEmployeesCount.text = "$employeesCount employees"
            viewBinding.cardOverviewAccounts.setOnClickListener {
                switchTab(WorkspaceTabAdapter.TAB_PEOPLE)
            }

            // Card 4: Out With A Rider
            val riderOrdersCount = ordersSummary?.statusCounts?.get("OUT_FOR_DELIVERY") ?: 0
            viewBinding.tvOverviewRiderOrdersCount.text = riderOrdersCount.toString()
            viewBinding.cardOverviewRider.setOnClickListener {
                switchTab(WorkspaceTabAdapter.TAB_DELIVERY_QUEUE)
            }

            // Card 5: Available Drivers
            val availableDrivers = settings?.availableDriversReady ?: 0
            viewBinding.tvOverviewAvailableDriversCount.text = availableDrivers.toString()
            viewBinding.tvOverviewDriversReadySubtext.text = if (availableDrivers > 0) {
                "$availableDrivers ready to deliver"
            } else {
                "0 drivers ready"
            }
            viewBinding.cardOverviewDrivers.setOnClickListener {
                switchTab(WorkspaceTabAdapter.TAB_DELIVERY_QUEUE)
            }

            // 2. SECTION 2: SALES AT A GLANCE (Bar Chart)
            viewBinding.btnOverviewFullReport.setOnClickListener {
                switchTab(WorkspaceTabAdapter.TAB_REPORTS)
            }
            val avgPaidOrderPaise = report?.averageOrderPaise ?: 0L
            viewBinding.tvOverviewAvgPaidOrder.text = CurrencyFormatter.formatPaise(avgPaidOrderPaise)

            val series = if (report != null && report.series.isNotEmpty()) report.series else getFallbackSeries()
            val maxRev = maxOf(1L, series.maxOfOrNull { it.revenuePaise } ?: 1L)

            viewBinding.tvChartAxisMax.text = CurrencyFormatter.formatPaise(maxRev)
            viewBinding.tvChartAxisMid.text = CurrencyFormatter.formatPaise(Math.round(maxRev / 2.0))
            viewBinding.tvChartAxisZero.text = "₹0"

            viewBinding.layoutChartBarsContainer.removeAllViews()
            val barMaxHeightPx = dpToPx(75)
            val barMinHeightPx = dpToPx(6)

            series.forEachIndexed { index, point ->
                val col = LinearLayout(this@WorkspaceTabActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    gravity = android.view.Gravity.BOTTOM or android.view.Gravity.CENTER_HORIZONTAL
                    val lp = LinearLayout.LayoutParams(dpToPx(44), ViewGroup.LayoutParams.MATCH_PARENT).apply {
                        marginStart = dpToPx(4)
                        marginEnd = dpToPx(4)
                    }
                    layoutParams = lp
                }

                val tvAmt = TextView(this@WorkspaceTabActivity).apply {
                    text = if (point.revenuePaise > 0) CurrencyFormatter.formatPaise(point.revenuePaise) else ""
                    textSize = 8.5f
                    setTextColor(ContextCompat.getColor(this@WorkspaceTabActivity, R.color.brand_muted))
                    gravity = android.view.Gravity.CENTER
                    maxLines = 1
                }

                val isLast = index == series.size - 1
                val h = if (point.revenuePaise > 0) {
                    Math.max(barMinHeightPx, ((point.revenuePaise.toFloat() / maxRev) * barMaxHeightPx).toInt())
                } else {
                    barMinHeightPx
                }

                val barView = View(this@WorkspaceTabActivity).apply {
                    val lp = LinearLayout.LayoutParams(dpToPx(24), h).apply {
                        topMargin = dpToPx(4)
                        bottomMargin = dpToPx(6)
                    }
                    layoutParams = lp
                    val bg = android.graphics.drawable.GradientDrawable().apply {
                        shape = android.graphics.drawable.GradientDrawable.RECTANGLE
                        val r = dpToPx(4).toFloat()
                        cornerRadii = floatArrayOf(r, r, r, r, 0f, 0f, 0f, 0f)
                        setColor(if (isLast) Color.parseColor("#B94738") else Color.parseColor("#E6DEC8"))
                    }
                    background = bg
                }

                val tvDay = TextView(this@WorkspaceTabActivity).apply {
                    text = point.label
                    textSize = 10f
                    setTextColor(ContextCompat.getColor(this@WorkspaceTabActivity, if (isLast) R.color.brand_red else R.color.brand_ink))
                    typeface = android.graphics.Typeface.DEFAULT_BOLD
                    gravity = android.view.Gravity.CENTER
                }

                col.addView(tvAmt)
                col.addView(barView)
                col.addView(tvDay)
                viewBinding.layoutChartBarsContainer.addView(col)
            }

            // 3. SECTION 3: TOP OF THE GRILL (Ranked Dishes)
            viewBinding.btnOverviewManageMenu.setOnClickListener {
                switchTab(WorkspaceTabAdapter.TAB_MENU)
            }
            viewBinding.layoutOverviewTopDishesList.removeAllViews()
            val topItems = report?.topItems ?: emptyList()
            if (topItems.isEmpty()) {
                viewBinding.tvOverviewTopDishesEmpty.visibility = View.VISIBLE
            } else {
                viewBinding.tvOverviewTopDishesEmpty.visibility = View.GONE
                val rankColors = listOf(
                    Pair(Color.parseColor("#FFEDD5"), Color.parseColor("#C2410C")), // 01 Orange
                    Pair(Color.parseColor("#DCFCE7"), Color.parseColor("#15803D")), // 02 Mint
                    Pair(Color.parseColor("#FCE7F3"), Color.parseColor("#BE185D")), // 03 Pink
                    Pair(Color.parseColor("#FEF3C7"), Color.parseColor("#B45309")), // 04 Amber
                    Pair(Color.parseColor("#FEF9C3"), Color.parseColor("#A16207"))  // 05 Yellow
                )

                topItems.take(5).forEachIndexed { index, item ->
                    val row = LinearLayout(this@WorkspaceTabActivity).apply {
                        orientation = LinearLayout.HORIZONTAL
                        gravity = android.view.Gravity.CENTER_VERTICAL
                        setPadding(0, dpToPx(10), 0, dpToPx(10))
                        isClickable = true
                        isFocusable = true
                        setOnClickListener {
                            switchTab(WorkspaceTabAdapter.TAB_MENU)
                        }
                    }

                    val colorPair = rankColors[index % rankColors.size]
                    val tvRank = TextView(this@WorkspaceTabActivity).apply {
                        val lp = LinearLayout.LayoutParams(dpToPx(30), dpToPx(28))
                        layoutParams = lp
                        gravity = android.view.Gravity.CENTER
                        text = String.format("%02d", index + 1)
                        textSize = 11f
                        typeface = android.graphics.Typeface.DEFAULT_BOLD
                        setTextColor(colorPair.second)
                        background = android.graphics.drawable.GradientDrawable().apply {
                            shape = android.graphics.drawable.GradientDrawable.RECTANGLE
                            cornerRadius = dpToPx(8).toFloat()
                            setColor(colorPair.first)
                        }
                    }

                    val textCol = LinearLayout(this@WorkspaceTabActivity).apply {
                        orientation = LinearLayout.VERTICAL
                        val lp = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                            marginStart = dpToPx(12)
                            marginEnd = dpToPx(8)
                        }
                        layoutParams = lp
                    }

                    val tvDishName = TextView(this@WorkspaceTabActivity).apply {
                        text = item.name
                        textSize = 13.5f
                        typeface = android.graphics.Typeface.DEFAULT_BOLD
                        setTextColor(ContextCompat.getColor(this@WorkspaceTabActivity, R.color.brand_ink))
                    }

                    val tvDishSub = TextView(this@WorkspaceTabActivity).apply {
                        text = "Hot off the grill"
                        textSize = 11f
                        setTextColor(ContextCompat.getColor(this@WorkspaceTabActivity, R.color.brand_muted))
                    }

                    textCol.addView(tvDishName)
                    textCol.addView(tvDishSub)

                    val tvSold = TextView(this@WorkspaceTabActivity).apply {
                        setPadding(dpToPx(10), dpToPx(4), dpToPx(10), dpToPx(4))
                        text = "${item.quantity} sold"
                        textSize = 11f
                        typeface = android.graphics.Typeface.DEFAULT_BOLD
                        setTextColor(Color.parseColor("#4B5563"))
                        background = android.graphics.drawable.GradientDrawable().apply {
                            shape = android.graphics.drawable.GradientDrawable.RECTANGLE
                            cornerRadius = dpToPx(12).toFloat()
                            setColor(Color.parseColor("#F3F4F6"))
                        }
                    }

                    row.addView(tvRank)
                    row.addView(textCol)
                    row.addView(tvSold)
                    viewBinding.layoutOverviewTopDishesList.addView(row)

                    if (index < topItems.take(5).size - 1) {
                        val div = View(this@WorkspaceTabActivity).apply {
                            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 1)
                            layoutParams = lp
                            setBackgroundColor(ContextCompat.getColor(this@WorkspaceTabActivity, R.color.brand_line))
                        }
                        viewBinding.layoutOverviewTopDishesList.addView(div)
                    }
                }
            }

            // 4. SECTION 4: RECENT ORDERS (The Latest From the Pass)
            viewBinding.btnOverviewSeeAllOrders.setOnClickListener {
                switchTab(WorkspaceTabAdapter.TAB_ORDER)
            }
            viewBinding.layoutOverviewRecentOrdersList.removeAllViews()
            val recentOrders = ordersSummary?.items?.take(5) ?: emptyList()
            if (recentOrders.isEmpty()) {
                viewBinding.tvOverviewRecentOrdersEmpty.visibility = View.VISIBLE
            } else {
                viewBinding.tvOverviewRecentOrdersEmpty.visibility = View.GONE
                recentOrders.forEachIndexed { index, order ->
                    val row = LinearLayout(this@WorkspaceTabActivity).apply {
                        orientation = LinearLayout.HORIZONTAL
                        gravity = android.view.Gravity.CENTER_VERTICAL
                        setPadding(0, dpToPx(12), 0, dpToPx(12))
                        isClickable = true
                        isFocusable = true
                        setOnClickListener {
                            switchTab(WorkspaceTabAdapter.TAB_ORDER)
                        }
                    }

                    val tvOrderId = TextView(this@WorkspaceTabActivity).apply {
                        val lp = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.1f)
                        layoutParams = lp
                        text = "#${order.orderId.takeLast(6).uppercase()}"
                        textSize = 12f
                        typeface = android.graphics.Typeface.MONOSPACE
                        setTextColor(ContextCompat.getColor(this@WorkspaceTabActivity, R.color.brand_ink))
                    }

                    val tvGuest = TextView(this@WorkspaceTabActivity).apply {
                        val lp = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.3f)
                        layoutParams = lp
                        text = order.customerName?.ifBlank { "Guest" } ?: "Guest"
                        textSize = 12f
                        typeface = android.graphics.Typeface.DEFAULT_BOLD
                        maxLines = 1
                        ellipsize = android.text.TextUtils.TruncateAt.END
                        setTextColor(ContextCompat.getColor(this@WorkspaceTabActivity, R.color.brand_ink))
                    }

                    val tvWhen = TextView(this@WorkspaceTabActivity).apply {
                        val lp = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.6f)
                        layoutParams = lp
                        text = formatFriendlyDate(order.createdAt)
                        textSize = 11f
                        setTextColor(ContextCompat.getColor(this@WorkspaceTabActivity, R.color.brand_muted))
                    }

                    val ivChevron = ImageView(this@WorkspaceTabActivity).apply {
                        val lp = LinearLayout.LayoutParams(dpToPx(16), dpToPx(16))
                        layoutParams = lp
                        setImageResource(R.drawable.ic_chevron_right)
                        setColorFilter(Color.parseColor("#9CA3AF"))
                    }

                    row.addView(tvOrderId)
                    row.addView(tvGuest)
                    row.addView(tvWhen)
                    row.addView(ivChevron)
                    viewBinding.layoutOverviewRecentOrdersList.addView(row)

                    if (index < recentOrders.size - 1) {
                        val div = View(this@WorkspaceTabActivity).apply {
                            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 1)
                            layoutParams = lp
                            setBackgroundColor(ContextCompat.getColor(this@WorkspaceTabActivity, R.color.brand_line))
                        }
                        viewBinding.layoutOverviewRecentOrdersList.addView(div)
                    }
                }
            }

            // 5. SECTION 5: NOTIFICATIONS & EVENT LOG
            viewBinding.btnOverviewAllUpdates.setOnClickListener {
                switchTab(WorkspaceTabAdapter.TAB_ACTIVITY)
            }
            viewBinding.layoutOverviewEventsList.removeAllViews()
            if (events.isEmpty()) {
                viewBinding.tvOverviewEventsEmpty.visibility = View.VISIBLE
            } else {
                viewBinding.tvOverviewEventsEmpty.visibility = View.GONE
                events.take(6).forEachIndexed { index, event ->
                    val row = LinearLayout(this@WorkspaceTabActivity).apply {
                        orientation = LinearLayout.VERTICAL
                        setPadding(0, dpToPx(10), 0, dpToPx(10))
                        isClickable = true
                        isFocusable = true
                        setOnClickListener {
                            switchTab(WorkspaceTabAdapter.TAB_ACTIVITY)
                        }
                    }

                    val tvMsg = TextView(this@WorkspaceTabActivity).apply {
                        text = event.description
                        textSize = 12.5f
                        typeface = android.graphics.Typeface.DEFAULT_BOLD
                        setTextColor(ContextCompat.getColor(this@WorkspaceTabActivity, R.color.brand_ink))
                    }

                    val tvMeta = TextView(this@WorkspaceTabActivity).apply {
                        val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                            topMargin = dpToPx(2)
                        }
                        layoutParams = lp
                        val actor = event.actorName ?: event.actorEmail ?: "System"
                        text = "$actor · ${formatFriendlyDate(event.createdAt)}"
                        textSize = 11f
                        setTextColor(ContextCompat.getColor(this@WorkspaceTabActivity, R.color.brand_muted))
                    }

                    row.addView(tvMsg)
                    row.addView(tvMeta)
                    viewBinding.layoutOverviewEventsList.addView(row)

                    if (index < events.take(6).size - 1) {
                        val div = View(this@WorkspaceTabActivity).apply {
                            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 1)
                            layoutParams = lp
                            setBackgroundColor(ContextCompat.getColor(this@WorkspaceTabActivity, R.color.brand_line))
                        }
                        viewBinding.layoutOverviewEventsList.addView(div)
                    }
                }
            }
        }
    }

    // =========================================================================
    // 2. ORDERS TAB (Master Orders, Status, Refund)
    // =========================================================================
    private fun renderOrdersTab() {
        binding.tvTabHeaderTitle.text = "Master Orders"
        binding.tvTabHeaderSubtitle.text = "Live orders, statuses & instant refunds"
        setupTopActionButton(R.drawable.ic_refresh) { renderOrdersTab() }

        val viewBinding = LayoutTabOrdersBinding.inflate(layoutInflater, binding.frameTabContent, true)
        val filterList = listOf("ALL", "PLACED", "ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED")
        var currentFilter = initialStatusFilter ?: "ALL"
        initialStatusFilter = null

        fun setupFilterChips() {
            viewBinding.layoutOrdersFilterChips.removeAllViews()
            for (f in filterList) {
                val chip = TextView(this).apply {
                    text = f.replace("_", " ").lowercase().replaceFirstChar { it.uppercase() }
                    setPadding(28, 14, 28, 14)
                    textSize = 12f
                    typeface = android.graphics.Typeface.DEFAULT_BOLD
                    val isSelected = f == currentFilter
                    background = ContextCompat.getDrawable(
                        this@WorkspaceTabActivity,
                        if (isSelected) R.drawable.bg_pill_primary else R.drawable.bg_pill_white
                    )
                    setTextColor(
                        ContextCompat.getColor(
                            this@WorkspaceTabActivity,
                            if (isSelected) R.color.white else R.color.brand_muted
                        )
                    )
                    val params = LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.WRAP_CONTENT,
                        ViewGroup.LayoutParams.WRAP_CONTENT
                    ).apply { marginEnd = 16 }
                    layoutParams = params
                    setOnClickListener {
                        currentFilter = f
                        setupFilterChips()
                        loadOrders(viewBinding, currentFilter, viewBinding.etAdminOrdersSearch.text.toString().trim())
                    }
                }
                viewBinding.layoutOrdersFilterChips.addView(chip)
            }
        }
        setupFilterChips()

        viewBinding.etAdminOrdersSearch.setOnEditorActionListener { _, _, _ ->
            loadOrders(viewBinding, currentFilter, viewBinding.etAdminOrdersSearch.text.toString().trim())
            true
        }

        viewBinding.rvAdminOrders.layoutManager = LinearLayoutManager(this)
        loadOrders(viewBinding, currentFilter, "")
    }

    private fun loadOrders(viewBinding: LayoutTabOrdersBinding, status: String, query: String) {
        setLoading(true)
        lifecycleScope.launch {
            val result = apiClient.getAdminOrders(status = status, query = query)
            setLoading(false)

            if (result is NetworkResult.Success) {
                val orders = result.data.orders
                if (orders.isEmpty()) {
                    viewBinding.tvAdminOrdersEmpty.visibility = View.VISIBLE
                    viewBinding.rvAdminOrders.visibility = View.GONE
                } else {
                    viewBinding.tvAdminOrdersEmpty.visibility = View.GONE
                    viewBinding.rvAdminOrders.visibility = View.VISIBLE
                    viewBinding.rvAdminOrders.adapter = AdminOrderAdapter(
                        orders = orders,
                        onAdvanceStatus = { order ->
                            val nextStatus = when (order.status) {
                                "PLACED" -> "ACCEPTED"
                                "ACCEPTED" -> "PREPARING"
                                "PREPARING" -> "READY"
                                "READY" -> "OUT_FOR_DELIVERY"
                                "OUT_FOR_DELIVERY" -> "DELIVERED"
                                else -> null
                            }
                            if (nextStatus != null) {
                                updateOrderStatus(order.orderId, nextStatus) {
                                    loadOrders(viewBinding, status, query)
                                }
                            }
                        },
                        onChangeStatus = { order ->
                            showStatusPicker(order) {
                                loadOrders(viewBinding, status, query)
                            }
                        },
                        onRefund = { order ->
                            confirmRefundOrder(order) {
                                loadOrders(viewBinding, status, query)
                            }
                        },
                        onOrderClick = { order ->
                            showOrderDetailDialog(order) {
                                loadOrders(viewBinding, status, query)
                            }
                        }
                    )
                }
            } else if (result is NetworkResult.Error) {
                Toast.makeText(this@WorkspaceTabActivity, result.message, Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun showStatusPicker(order: Order, onSuccess: () -> Unit) {
        val statuses = arrayOf("PLACED", "ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED", "REJECTED")
        val currentIndex = statuses.indexOf(order.status).coerceAtLeast(0)

        AlertDialog.Builder(this)
            .setTitle("Change Status: Order #${order.orderId}")
            .setSingleChoiceItems(statuses, currentIndex) { dialog, which ->
                dialog.dismiss()
                val selectedStatus = statuses[which]
                if (selectedStatus != order.status) {
                    updateOrderStatus(order.orderId, selectedStatus, onSuccess)
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun showOrderDetailDialog(order: Order, onStatusChanged: () -> Unit) {
        val itemsText = order.items.joinToString("\n") {
            val varText = if (!it.variationName.isNullOrBlank()) " (${it.variationName})" else ""
            "• ${it.quantity}× ${it.name}$varText — ${CurrencyFormatter.formatPaise(it.lineTotalPaise)}"
        }

        val msg = StringBuilder()
            .append("Customer: ").append(order.customerName ?: "Customer").append("\n")
            .append("Phone: ").append(order.customerPhone?.ifBlank { "Not provided" } ?: "Not provided").append("\n")
            .append("Address: ").append(order.address ?: "Counter pickup").append("\n")
            .append("Payment: ").append(order.paymentMethod ?: "COD").append(" (").append(order.paymentStatus).append(")\n\n")
            .append("Dishes:\n").append(itemsText.ifBlank { "• Standard Order" }).append("\n\n")
            .append("Total Amount: ").append(CurrencyFormatter.formatPaise(order.totalPaise))
            .toString()

        val builder = AlertDialog.Builder(this)
            .setTitle("Order #${order.orderId} Details")
            .setMessage(msg)
            .setPositiveButton("Change Status") { dialog, _ ->
                dialog.dismiss()
                showStatusPicker(order, onStatusChanged)
            }
            .setNeutralButton("Close", null)

        if (!order.customerPhone.isNullOrBlank()) {
            builder.setNegativeButton("Call Customer") { _, _ ->
                val dialIntent = Intent(Intent.ACTION_DIAL, Uri.parse("tel:${order.customerPhone}"))
                startActivity(dialIntent)
            }
        }
        builder.show()
    }

    private fun updateOrderStatus(orderId: String, status: String, onSuccess: () -> Unit) {
        setLoading(true)
        lifecycleScope.launch {
            val res = apiClient.updateAdminOrderStatus(orderId, status)
            setLoading(false)
            if (res is NetworkResult.Success) {
                Toast.makeText(this@WorkspaceTabActivity, "Order updated to $status", Toast.LENGTH_SHORT).show()
                onSuccess()
            } else if (res is NetworkResult.Error) {
                Toast.makeText(this@WorkspaceTabActivity, res.message, Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun confirmRefundOrder(order: Order, onSuccess: () -> Unit) {
        AlertDialog.Builder(this)
            .setTitle("Confirm Refund")
            .setMessage("Issue full refund of ${CurrencyFormatter.formatPaise(order.totalPaise)} for Order #${order.orderId}?")
            .setPositiveButton("Refund") { dialog, _ ->
                dialog.dismiss()
                setLoading(true)
                lifecycleScope.launch {
                    val res = apiClient.refundAdminOrder(order.orderId, "Customer cancellation / Admin refund")
                    setLoading(false)
                    if (res is NetworkResult.Success) {
                        Toast.makeText(this@WorkspaceTabActivity, "Refund processed successfully", Toast.LENGTH_LONG).show()
                        onSuccess()
                    } else if (res is NetworkResult.Error) {
                        Toast.makeText(this@WorkspaceTabActivity, res.message, Toast.LENGTH_SHORT).show()
                    }
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    // =========================================================================
    // 3. MENU TAB (Catalog, Stock toggle, Variations)
    // =========================================================================
    private fun renderMenuTab() {
        binding.tvTabHeaderTitle.text = "Menu Catalog"
        binding.tvTabHeaderSubtitle.text = "Variations, pricing & real-time stock toggle"
        setupTopActionButton(R.drawable.ic_add) {
            showAddMenuItemDialog { renderMenuTab() }
        }

        val viewBinding = LayoutTabMenuBinding.inflate(layoutInflater, binding.frameTabContent, true)
        viewBinding.rvAdminMenu.layoutManager = LinearLayoutManager(this)

        var selectedCategory = "All"
        var currentItems = listOf<MenuItem>()

        fun filterAndDisplay(query: String = "") {
            var filtered = if (selectedCategory != "All") {
                currentItems.filter { it.category.equals(selectedCategory, ignoreCase = true) }
            } else currentItems

            if (query.isNotBlank()) {
                filtered = filtered.filter { it.name.contains(query, ignoreCase = true) || it.category.contains(query, ignoreCase = true) }
            }

            if (filtered.isEmpty()) {
                viewBinding.tvAdminMenuEmpty.visibility = View.VISIBLE
                viewBinding.rvAdminMenu.visibility = View.GONE
            } else {
                viewBinding.tvAdminMenuEmpty.visibility = View.GONE
                viewBinding.rvAdminMenu.visibility = View.VISIBLE
                viewBinding.rvAdminMenu.adapter = AdminMenuAdapter(
                    items = filtered,
                    onStockToggle = { item, isAvailable ->
                        lifecycleScope.launch {
                            val toggleRes = apiClient.toggleMenuPause(item.id.toString(), !isAvailable)
                            if (toggleRes is NetworkResult.Success) {
                                Toast.makeText(
                                    this@WorkspaceTabActivity,
                                    "${item.name} ${if (isAvailable) "restocked (Live)" else "paused (86ed)"}",
                                    Toast.LENGTH_SHORT
                                ).show()
                            } else if (toggleRes is NetworkResult.Error) {
                                Toast.makeText(this@WorkspaceTabActivity, toggleRes.message, Toast.LENGTH_SHORT).show()
                            }
                        }
                    },
                    onItemClick = { item ->
                        showMenuItemDetailDialog(item) {
                            renderMenuTab()
                        }
                    }
                )
            }
        }

        fun buildCategoryChips(categories: List<String>) {
            viewBinding.layoutMenuCategoryChips.removeAllViews()
            val allCats = listOf("All") + categories
            for (cat in allCats) {
                val chip = TextView(this).apply {
                    text = cat
                    setPadding(28, 14, 28, 14)
                    textSize = 12f
                    typeface = android.graphics.Typeface.DEFAULT_BOLD
                    val isSelected = cat == selectedCategory
                    background = ContextCompat.getDrawable(
                        this@WorkspaceTabActivity,
                        if (isSelected) R.drawable.bg_pill_primary else R.drawable.bg_pill_white
                    )
                    setTextColor(
                        ContextCompat.getColor(
                            this@WorkspaceTabActivity,
                            if (isSelected) R.color.white else R.color.brand_muted
                        )
                    )
                    val lp = LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.WRAP_CONTENT,
                        ViewGroup.LayoutParams.WRAP_CONTENT
                    ).apply { marginEnd = 16 }
                    layoutParams = lp
                    setOnClickListener {
                        selectedCategory = cat
                        buildCategoryChips(categories)
                        filterAndDisplay(viewBinding.etMenuSearch.text.toString().trim())
                    }
                }
                viewBinding.layoutMenuCategoryChips.addView(chip)
            }
        }

        fun loadMenu() {
            setLoading(true)
            lifecycleScope.launch {
                val menuRes = apiClient.getAllMenuItemsCombined()
                val pausesRes = apiClient.getMenuPauses()
                setLoading(false)

                if (menuRes is NetworkResult.Success) {
                    val pausedIds = (pausesRes as? NetworkResult.Success)?.data?.map { it.menuItemId }?.toSet() ?: emptySet()
                    currentItems = menuRes.data.map { item ->
                        item.copy(isPaused = pausedIds.contains(item.id.toString()) || item.isPaused)
                    }

                    val distinctCategories = currentItems.map { it.category }.distinct().filter { it.isNotBlank() }
                    buildCategoryChips(distinctCategories)
                    filterAndDisplay(viewBinding.etMenuSearch.text.toString().trim())
                } else if (menuRes is NetworkResult.Error) {
                    Toast.makeText(this@WorkspaceTabActivity, menuRes.message, Toast.LENGTH_SHORT).show()
                }
            }
        }

        viewBinding.etMenuSearch.setOnEditorActionListener { _, _, _ ->
            filterAndDisplay(viewBinding.etMenuSearch.text.toString().trim())
            true
        }
        loadMenu()
    }

    private fun showMenuItemDetailDialog(item: MenuItem, onModified: () -> Unit) {
        val variationsDesc = if (item.variations.isNotEmpty()) {
            "\n\nVariations:\n" + item.variations.joinToString("\n") { "• ${it.name}: ${CurrencyFormatter.formatPaise(it.pricePaise)}" }
        } else ""

        val desc = item.description?.ifBlank { "No description" } ?: "No description"
        val msg = "Category: ${item.category}\nPrice: ${CurrencyFormatter.formatPaise(item.displayPricePaise)}\nDiet: ${if (item.isVegetarian) "Vegetarian" else "Non-Vegetarian"}\nStatus: ${if (item.isPaused) "Paused (86ed)" else "Live in stock"}\nDescription: $desc$variationsDesc"

        AlertDialog.Builder(this)
            .setTitle(item.name)
            .setMessage(msg)
            .setPositiveButton("Toggle Stock") { _, _ ->
                val newPaused = !item.isPaused
                setLoading(true)
                lifecycleScope.launch {
                    val res = apiClient.toggleMenuPause(item.id.toString(), newPaused)
                    setLoading(false)
                    if (res is NetworkResult.Success) {
                        Toast.makeText(this@WorkspaceTabActivity, "${item.name} stock toggled", Toast.LENGTH_SHORT).show()
                        onModified()
                    } else if (res is NetworkResult.Error) {
                        Toast.makeText(this@WorkspaceTabActivity, res.message, Toast.LENGTH_SHORT).show()
                    }
                }
            }
            .setNegativeButton("Delete Item") { _, _ ->
                AlertDialog.Builder(this)
                    .setTitle("Delete ${item.name}?")
                    .setMessage("Are you sure you want to remove this dish from the menu catalog?")
                    .setPositiveButton("Delete") { _, _ ->
                        setLoading(true)
                        lifecycleScope.launch {
                            val delRes = apiClient.deleteMenuItem(item.id)
                            setLoading(false)
                            if (delRes is NetworkResult.Success) {
                                Toast.makeText(this@WorkspaceTabActivity, "${item.name} deleted", Toast.LENGTH_SHORT).show()
                                onModified()
                            } else if (delRes is NetworkResult.Error) {
                                Toast.makeText(this@WorkspaceTabActivity, delRes.message, Toast.LENGTH_SHORT).show()
                            }
                        }
                    }
                    .setNegativeButton("Cancel", null)
                    .show()
            }
            .setNeutralButton("Close", null)
            .show()
    }

    private fun showAddMenuItemDialog(onAdded: () -> Unit) {
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 24, 48, 24)
        }

        val etName = EditText(this).apply { hint = "Dish Name (e.g. Chicken Shawarma Roll)" }
        val etCat = EditText(this).apply { hint = "Category (e.g. Rolls, Kebabs)" }
        val etPrice = EditText(this).apply { hint = "Base Price in ₹ (e.g. 180)"; inputType = android.text.InputType.TYPE_CLASS_NUMBER }
        val etDesc = EditText(this).apply { hint = "Description (optional)" }

        val switchVeg = SwitchCompat(this).apply {
            text = "Vegetarian Dish"
            isChecked = false
            setPadding(0, 16, 0, 16)
        }

        layout.addView(TextView(this).apply { text = "Add New Menu Item"; textSize = 18f; typeface = android.graphics.Typeface.DEFAULT_BOLD })
        layout.addView(etName)
        layout.addView(etCat)
        layout.addView(etPrice)
        layout.addView(etDesc)
        layout.addView(switchVeg)

        AlertDialog.Builder(this)
            .setView(layout)
            .setPositiveButton("Add Dish") { dialog, _ ->
                val name = etName.text.toString().trim()
                val cat = etCat.text.toString().trim().ifBlank { "Specials" }
                val priceNum = etPrice.text.toString().toLongOrNull()
                val desc = etDesc.text.toString().trim()
                val isVeg = switchVeg.isChecked

                if (name.isBlank() || priceNum == null || priceNum <= 0) {
                    Toast.makeText(this, "Please enter valid name and price", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }

                val pricePaise = priceNum * 100L
                setLoading(true)
                lifecycleScope.launch {
                    val res = apiClient.createMenuItem(
                        name = name,
                        description = desc,
                        category = cat,
                        pricePaise = pricePaise,
                        isVeg = isVeg
                    )
                    setLoading(false)
                    if (res is NetworkResult.Success) {
                        Toast.makeText(this@WorkspaceTabActivity, "$name added to catalog!", Toast.LENGTH_LONG).show()
                        onAdded()
                    } else if (res is NetworkResult.Error) {
                        Toast.makeText(this@WorkspaceTabActivity, res.message, Toast.LENGTH_SHORT).show()
                    }
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    // =========================================================================
    // 4. PEOPLE TAB (Team Roster & Provisioning)
    // =========================================================================
    private fun renderPeopleTab() {
        binding.tvTabHeaderTitle.text = "People & Team"
        binding.tvTabHeaderSubtitle.text = "Team roster, kitchen roles & rider staff"
        setupTopActionButton(R.drawable.ic_add) {
            showAddStaffDialog { renderPeopleTab() }
        }

        val viewBinding = LayoutTabPeopleBinding.inflate(layoutInflater, binding.frameTabContent, true)
        viewBinding.rvStaffMembers.layoutManager = LinearLayoutManager(this)

        var staffList = listOf<AdminAccount>()
        var selectedRole = "ALL"

        fun filterStaff() {
            val q = viewBinding.etStaffSearch.text.toString().trim()
            var filtered = if (selectedRole != "ALL") {
                staffList.filter { it.role.equals(selectedRole, ignoreCase = true) }
            } else staffList

            if (q.isNotBlank()) {
                filtered = filtered.filter { it.name.contains(q, ignoreCase = true) || it.email.contains(q, ignoreCase = true) }
            }

            viewBinding.tvStaffCountSummary.text = "${filtered.size} Team Members"
            if (filtered.isEmpty()) {
                viewBinding.tvStaffEmpty.visibility = View.VISIBLE
                viewBinding.rvStaffMembers.visibility = View.GONE
            } else {
                viewBinding.tvStaffEmpty.visibility = View.GONE
                viewBinding.rvStaffMembers.visibility = View.VISIBLE
                viewBinding.rvStaffMembers.adapter = AdminStaffAdapter(filtered) { staff ->
                    showStaffActionsDialog(staff) {
                        renderPeopleTab()
                    }
                }
            }
        }

        fun setupRoleChips() {
            viewBinding.layoutStaffRoleChips.removeAllViews()
            val roles = listOf("ALL", "STAFF", "RIDER", "ADMIN")
            for (r in roles) {
                val chip = TextView(this).apply {
                    text = r
                    setPadding(28, 14, 28, 14)
                    textSize = 12f
                    typeface = android.graphics.Typeface.DEFAULT_BOLD
                    val isSelected = r == selectedRole
                    background = ContextCompat.getDrawable(
                        this@WorkspaceTabActivity,
                        if (isSelected) R.drawable.bg_pill_primary else R.drawable.bg_pill_white
                    )
                    setTextColor(
                        ContextCompat.getColor(
                            this@WorkspaceTabActivity,
                            if (isSelected) R.color.white else R.color.brand_muted
                        )
                    )
                    val lp = LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.WRAP_CONTENT,
                        ViewGroup.LayoutParams.WRAP_CONTENT
                    ).apply { marginEnd = 16 }
                    layoutParams = lp
                    setOnClickListener {
                        selectedRole = r
                        setupRoleChips()
                        filterStaff()
                    }
                }
                viewBinding.layoutStaffRoleChips.addView(chip)
            }
        }
        setupRoleChips()

        viewBinding.etStaffSearch.setOnEditorActionListener { _, _, _ ->
            filterStaff()
            true
        }

        viewBinding.btnAddStaffMember.setOnClickListener {
            showAddStaffDialog {
                renderPeopleTab()
            }
        }

        setLoading(true)
        lifecycleScope.launch {
            val res = apiClient.getAdminAccounts(excludeUsers = false)
            setLoading(false)

            if (res is NetworkResult.Success) {
                staffList = res.data
                filterStaff()
            } else if (res is NetworkResult.Error) {
                Toast.makeText(this@WorkspaceTabActivity, res.message, Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun showStaffActionsDialog(staff: AdminAccount, onUpdated: () -> Unit) {
        val options = mutableListOf("Change Role", "View Account Orders")
        if (!staff.phone.isNullOrBlank()) {
            options.add("Call Staff (+91)")
        }

        AlertDialog.Builder(this)
            .setTitle("${staff.name} (${staff.role})")
            .setItems(options.toTypedArray()) { _, which ->
                when (options[which]) {
                    "Change Role" -> showChangeRoleDialog(staff, onUpdated)
                    "View Account Orders" -> showStaffOrdersDialog(staff)
                    "Call Staff (+91)" -> {
                        val dialIntent = Intent(Intent.ACTION_DIAL, Uri.parse("tel:${staff.phone}"))
                        startActivity(dialIntent)
                    }
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun showChangeRoleDialog(staff: AdminAccount, onUpdated: () -> Unit) {
        val roles = arrayOf("STAFF", "RIDER", "ADMIN")
        val currentIndex = roles.indexOf(staff.role).coerceAtLeast(0)
        var selectedRole = staff.role

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 20, 48, 20)
        }
        val etAdminPassword = EditText(this).apply {
            hint = "Confirm Admin Password"
            inputType = android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD or android.text.InputType.TYPE_CLASS_TEXT
        }
        val tvInstruction = TextView(this).apply {
            text = "Select new role for ${staff.name} and confirm with your admin password:"
            textSize = 13f
            setTextColor(ContextCompat.getColor(context, R.color.brand_ink))
            setPadding(0, 0, 0, 16)
        }
        val rg = RadioGroup(this).apply { orientation = RadioGroup.VERTICAL }
        for (r in roles) {
            val rb = RadioButton(this).apply {
                text = r
                isChecked = r == staff.role
                setOnCheckedChangeListener { _, isChecked ->
                    if (isChecked) selectedRole = r
                }
            }
            rg.addView(rb)
        }
        layout.addView(tvInstruction)
        layout.addView(rg)
        layout.addView(etAdminPassword)

        AlertDialog.Builder(this)
            .setTitle("Change Role")
            .setView(layout)
            .setPositiveButton("Update Role") { _, _ ->
                val pass = etAdminPassword.text.toString().trim()
                if (pass.isBlank()) {
                    Toast.makeText(this, "Admin password required", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }
                setLoading(true)
                lifecycleScope.launch {
                    val res = apiClient.updateStaffAccountRole(staff.id, selectedRole, pass)
                    setLoading(false)
                    if (res is NetworkResult.Success) {
                        Toast.makeText(this@WorkspaceTabActivity, "Role updated to $selectedRole", Toast.LENGTH_SHORT).show()
                        onUpdated()
                    } else if (res is NetworkResult.Error) {
                        Toast.makeText(this@WorkspaceTabActivity, res.message, Toast.LENGTH_SHORT).show()
                    }
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun showStaffOrdersDialog(staff: AdminAccount) {
        setLoading(true)
        lifecycleScope.launch {
            val res = apiClient.getAccountOrders(staff.id)
            setLoading(false)

            if (res is NetworkResult.Success) {
                val orders = res.data
                if (orders.isEmpty()) {
                    AlertDialog.Builder(this@WorkspaceTabActivity)
                        .setTitle("Orders: ${staff.name}")
                        .setMessage("No orders recorded for this account.")
                        .setPositiveButton("OK", null)
                        .show()
                } else {
                    val summary = orders.take(10).joinToString("\n\n") {
                        "Order #${it.orderId} · ${it.status}\nTotal: ${CurrencyFormatter.formatPaise(it.totalPaise)} · ${it.createdAt ?: "Recently"}"
                    }
                    AlertDialog.Builder(this@WorkspaceTabActivity)
                        .setTitle("Orders: ${staff.name} (${orders.size})")
                        .setMessage(summary)
                        .setPositiveButton("Done", null)
                        .show()
                }
            } else if (res is NetworkResult.Error) {
                Toast.makeText(this@WorkspaceTabActivity, res.message, Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun showAddStaffDialog(onStaffAdded: () -> Unit) {
        val etName = EditText(this).apply { hint = "Full Name"; inputType = android.text.InputType.TYPE_TEXT_VARIATION_PERSON_NAME }
        val etEmail = EditText(this).apply { hint = "Email Address"; inputType = android.text.InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS }
        val etPhone = EditText(this).apply { hint = "Phone (+91)"; inputType = android.text.InputType.TYPE_CLASS_PHONE }
        val etPassword = EditText(this).apply { hint = "Temporary Password"; inputType = android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD or android.text.InputType.TYPE_CLASS_TEXT }

        val rgRole = RadioGroup(this).apply {
            orientation = RadioGroup.HORIZONTAL
            setPadding(0, 16, 0, 16)
        }
        val rbStaff = RadioButton(this).apply { text = "Staff"; isChecked = true; id = View.generateViewId() }
        val rbRider = RadioButton(this).apply { text = "Rider"; id = View.generateViewId() }
        val rbAdmin = RadioButton(this).apply { text = "Admin"; id = View.generateViewId() }
        rgRole.addView(rbStaff)
        rgRole.addView(rbRider)
        rgRole.addView(rbAdmin)

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 24, 48, 24)
            addView(TextView(context).apply { text = "Add Team Member"; textSize = 18f; typeface = android.graphics.Typeface.DEFAULT_BOLD })
            addView(etName)
            addView(etEmail)
            addView(etPhone)
            addView(etPassword)
            addView(rgRole)
        }

        AlertDialog.Builder(this)
            .setView(layout)
            .setPositiveButton("Create Account") { dialog, _ ->
                val name = etName.text.toString().trim()
                val email = etEmail.text.toString().trim()
                val phone = etPhone.text.toString().trim()
                val pass = etPassword.text.toString().trim()
                val role = when (rgRole.checkedRadioButtonId) {
                    rbRider.id -> "RIDER"
                    rbAdmin.id -> "ADMIN"
                    else -> "STAFF"
                }

                if (name.isBlank() || email.isBlank() || pass.isBlank()) {
                    Toast.makeText(this@WorkspaceTabActivity, "Please fill required fields", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }

                setLoading(true)
                lifecycleScope.launch {
                    val res = apiClient.createAdminAccount(name, email, phone, role, pass)
                    setLoading(false)
                    if (res is NetworkResult.Success) {
                        Toast.makeText(this@WorkspaceTabActivity, "Staff member $name created!", Toast.LENGTH_LONG).show()
                        onStaffAdded()
                    } else if (res is NetworkResult.Error) {
                        Toast.makeText(this@WorkspaceTabActivity, res.message, Toast.LENGTH_SHORT).show()
                    }
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    // =========================================================================
    // 5. ACTIVITY TAB (System Audit Trail)
    // =========================================================================
    private fun renderActivityTab() {
        binding.tvTabHeaderTitle.text = "Activity Center"
        binding.tvTabHeaderSubtitle.text = "System audit trail & recent status logs"
        setupTopActionButton(R.drawable.ic_refresh) { renderActivityTab() }

        val viewBinding = LayoutTabActivityBinding.inflate(layoutInflater, binding.frameTabContent, true)
        viewBinding.rvActivityEvents.layoutManager = LinearLayoutManager(this)

        setLoading(true)
        lifecycleScope.launch {
            val res = apiClient.getAdminEvents()
            setLoading(false)

            if (res is NetworkResult.Success) {
                val events = res.data
                if (events.isEmpty()) {
                    viewBinding.tvActivityEmpty.visibility = View.VISIBLE
                    viewBinding.rvActivityEvents.visibility = View.GONE
                } else {
                    viewBinding.tvActivityEmpty.visibility = View.GONE
                    viewBinding.rvActivityEvents.visibility = View.VISIBLE
                    viewBinding.rvActivityEvents.adapter = AdminEventAdapter(events)
                }
            } else if (res is NetworkResult.Error) {
                Toast.makeText(this@WorkspaceTabActivity, res.message, Toast.LENGTH_SHORT).show()
            }
        }
    }

    // =========================================================================
    // 6. BROADCAST TAB (Push alerts & emergency announcements)
    // =========================================================================
    private fun renderBroadcastTab() {
        binding.tvTabHeaderTitle.text = "Marketing & Campaigns"
        binding.tvTabHeaderSubtitle.text = "Design & dispatch email offers to customers"
        setupTopActionButton(R.drawable.ic_refresh) { renderBroadcastTab() }

        val viewBinding = LayoutTabBroadcastBinding.inflate(layoutInflater, binding.frameTabContent, true)
        var selectedAudience = "ALL"
        var selectedChannel = "EMAIL"

        fun updateChannelUI() {
            if (selectedChannel == "EMAIL") {
                viewBinding.btnChannelEmail.background = ContextCompat.getDrawable(this, R.drawable.bg_pill_primary)
                viewBinding.btnChannelEmail.setTextColor(ContextCompat.getColor(this, R.color.white))
                viewBinding.btnChannelSms.background = null
                viewBinding.btnChannelSms.setTextColor(ContextCompat.getColor(this, R.color.brand_muted))
                viewBinding.cardSmsNotice.visibility = View.GONE
                viewBinding.cardCampaignComposer.visibility = View.VISIBLE
            } else {
                viewBinding.btnChannelSms.background = ContextCompat.getDrawable(this, R.drawable.bg_pill_primary)
                viewBinding.btnChannelSms.setTextColor(ContextCompat.getColor(this, R.color.white))
                viewBinding.btnChannelEmail.background = null
                viewBinding.btnChannelEmail.setTextColor(ContextCompat.getColor(this, R.color.brand_muted))
                viewBinding.cardSmsNotice.visibility = View.VISIBLE
                viewBinding.cardCampaignComposer.visibility = View.GONE
            }
        }

        viewBinding.btnChannelEmail.setOnClickListener { selectedChannel = "EMAIL"; updateChannelUI() }
        viewBinding.btnChannelSms.setOnClickListener { selectedChannel = "SMS"; updateChannelUI() }

        fun updateAudienceUI() {
            viewBinding.chipAudienceAll.background = ContextCompat.getDrawable(this, if (selectedAudience == "ALL") R.drawable.bg_pill_primary else R.drawable.bg_pill_white)
            viewBinding.chipAudienceAll.setTextColor(ContextCompat.getColor(this, if (selectedAudience == "ALL") R.color.white else R.color.brand_ink))

            viewBinding.chipAudienceNew.background = ContextCompat.getDrawable(this, if (selectedAudience == "NEW") R.drawable.bg_pill_primary else R.drawable.bg_pill_white)
            viewBinding.chipAudienceNew.setTextColor(ContextCompat.getColor(this, if (selectedAudience == "NEW") R.color.white else R.color.brand_ink))

            viewBinding.chipAudienceReturning.background = ContextCompat.getDrawable(this, if (selectedAudience == "RETURNING") R.drawable.bg_pill_primary else R.drawable.bg_pill_white)
            viewBinding.chipAudienceReturning.setTextColor(ContextCompat.getColor(this, if (selectedAudience == "RETURNING") R.color.white else R.color.brand_ink))
        }

        viewBinding.chipAudienceAll.setOnClickListener { selectedAudience = "ALL"; updateAudienceUI() }
        viewBinding.chipAudienceNew.setOnClickListener { selectedAudience = "NEW"; updateAudienceUI() }
        viewBinding.chipAudienceReturning.setOnClickListener { selectedAudience = "RETURNING"; updateAudienceUI() }

        // Live interactive preview text watchers
        viewBinding.etBroadcastHeadline.doAfterTextChanged {
            val text = it?.toString()?.trim()
            viewBinding.tvPreviewHeadline.text = if (!text.isNullOrBlank()) text else "FLAVOUR UNLEASHED"
        }
        viewBinding.etBroadcastSubheading.doAfterTextChanged {
            val text = it?.toString()?.trim()
            viewBinding.tvPreviewSubheading.text = if (!text.isNullOrBlank()) text else "Authentic Charcoal Kebabs & Fast Casual Dining"
        }
        viewBinding.etBroadcastDiscount.doAfterTextChanged {
            val text = it?.toString()?.trim()
            if (!text.isNullOrBlank()) {
                viewBinding.tvPreviewDiscount.visibility = View.VISIBLE
                viewBinding.tvPreviewDiscount.text = text
            } else {
                viewBinding.tvPreviewDiscount.text = "20% OFF"
            }
        }
        viewBinding.etBroadcastPromoCode.doAfterTextChanged {
            val text = it?.toString()?.trim()
            if (!text.isNullOrBlank()) {
                viewBinding.tvPreviewPromoCode.visibility = View.VISIBLE
                viewBinding.tvPreviewPromoCode.text = "CODE: $text"
            } else {
                viewBinding.tvPreviewPromoCode.text = "CODE: KEBAB20"
            }
        }
        viewBinding.etBroadcastMessage.doAfterTextChanged {
            val text = it?.toString()?.trim()
            viewBinding.tvPreviewMessage.text = if (!text.isNullOrBlank()) text else "Warm kebabs, fresh aromatics, and rich saffron biryani are ready for you this weekend."
        }
        viewBinding.etBroadcastCtaText.doAfterTextChanged {
            val text = it?.toString()?.trim()
            viewBinding.btnPreviewCta.text = if (!text.isNullOrBlank()) "$text →" else "Order Fresh Kebabs →"
        }

        fun loadLogs() {
            lifecycleScope.launch {
                val res = apiClient.getOfferLogs()
                if (res is NetworkResult.Success) {
                    viewBinding.layoutPastBroadcasts.removeAllViews()
                    if (res.data.isEmpty()) {
                        viewBinding.layoutPastBroadcasts.addView(TextView(this@WorkspaceTabActivity).apply {
                            text = "No campaign dispatch logs yet."
                            setTextColor(ContextCompat.getColor(context, R.color.brand_muted))
                            textSize = 13f
                            setPadding(0, 16, 0, 16)
                        })
                    } else {
                        for (log in res.data) {
                            val card = com.google.android.material.card.MaterialCardView(this@WorkspaceTabActivity).apply {
                                radius = 12 * resources.displayMetrics.density
                                strokeColor = ContextCompat.getColor(context, R.color.brand_line)
                                strokeWidth = (1 * resources.displayMetrics.density).toInt()
                                setCardBackgroundColor(ContextCompat.getColor(context, R.color.brand_paper_card))
                                val inner = LinearLayout(context).apply {
                                    orientation = LinearLayout.VERTICAL
                                    setPadding(32, 24, 32, 24)

                                    val topRow = LinearLayout(context).apply {
                                        orientation = LinearLayout.HORIZONTAL
                                        gravity = android.view.Gravity.CENTER_VERTICAL
                                        addView(TextView(context).apply {
                                            text = log.subject
                                            textSize = 14f
                                            typeface = android.graphics.Typeface.DEFAULT_BOLD
                                            setTextColor(ContextCompat.getColor(context, R.color.brand_ink))
                                            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                                        })
                                        addView(TextView(context).apply {
                                            text = log.status
                                            textSize = 10f
                                            typeface = android.graphics.Typeface.DEFAULT_BOLD
                                            background = ContextCompat.getDrawable(context, R.drawable.bg_pill_white)
                                            setPadding(16, 6, 16, 6)
                                            setTextColor(ContextCompat.getColor(context, if (log.status == "FAILED") R.color.brand_red else R.color.brand_emerald))
                                        })
                                    }
                                    addView(topRow)

                                    if (log.message.isNotBlank()) {
                                        addView(TextView(context).apply {
                                            text = log.message
                                            textSize = 12f
                                            setTextColor(ContextCompat.getColor(context, R.color.brand_muted))
                                            setPadding(0, 8, 0, 8)
                                        })
                                    }

                                    addView(TextView(context).apply {
                                        text = "Audience: ${log.audience} · ${log.channel} · Sent to ${log.recipientCount} guests"
                                        textSize = 11f
                                        setTextColor(ContextCompat.getColor(context, R.color.brand_muted))
                                    })
                                }
                                addView(inner)
                                val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                    bottomMargin = 16
                                }
                                layoutParams = lp
                            }
                            viewBinding.layoutPastBroadcasts.addView(card)
                        }
                    }
                }
            }
        }
        loadLogs()

        viewBinding.btnSendBroadcast.setOnClickListener {
            val subject = viewBinding.etBroadcastSubject.text.toString().trim()
            val message = viewBinding.etBroadcastMessage.text.toString().trim()
            val headline = viewBinding.etBroadcastHeadline.text.toString().trim().takeIf { it.isNotBlank() }
            val subheading = viewBinding.etBroadcastSubheading.text.toString().trim().takeIf { it.isNotBlank() }
            val promoCode = viewBinding.etBroadcastPromoCode.text.toString().trim().takeIf { it.isNotBlank() }
            val discount = viewBinding.etBroadcastDiscount.text.toString().trim().takeIf { it.isNotBlank() }
            val ctaText = viewBinding.etBroadcastCtaText.text.toString().trim().takeIf { it.isNotBlank() }
            val ctaUrl = viewBinding.etBroadcastCtaUrl.text.toString().trim().takeIf { it.isNotBlank() }

            if (subject.isBlank() || message.isBlank()) {
                Toast.makeText(this, "Please enter both subject line and message body", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            setLoading(true)
            lifecycleScope.launch {
                val res = apiClient.sendOfferBroadcast(
                    subject = subject,
                    message = message,
                    audience = selectedAudience,
                    channels = listOf("EMAIL"),
                    headline = headline,
                    subheading = subheading,
                    promoCode = promoCode,
                    discountHighlight = discount,
                    ctaText = ctaText,
                    ctaUrl = ctaUrl
                )
                setLoading(false)
                if (res is NetworkResult.Success) {
                    Toast.makeText(this@WorkspaceTabActivity, "Campaign broadcast dispatched successfully!", Toast.LENGTH_LONG).show()
                    viewBinding.etBroadcastSubject.setText("")
                    viewBinding.etBroadcastMessage.setText("")
                    viewBinding.etBroadcastHeadline.setText("")
                    viewBinding.etBroadcastSubheading.setText("")
                    viewBinding.etBroadcastPromoCode.setText("")
                    viewBinding.etBroadcastDiscount.setText("")
                    viewBinding.etBroadcastCtaText.setText("")
                    viewBinding.etBroadcastCtaUrl.setText("")
                    loadLogs()
                } else if (res is NetworkResult.Error) {
                    Toast.makeText(this@WorkspaceTabActivity, res.message, Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    // =========================================================================
    // 7. DISCOUNT TAB (Coupons & Promo Codes)
    // =========================================================================
    private fun renderDiscountTab() {
        binding.tvTabHeaderTitle.text = "Discounts & Coupons"
        binding.tvTabHeaderSubtitle.text = "Promo coupons, % off & flat discounts"
        setupTopActionButton(R.drawable.ic_add) {
            showCreateDiscountDialog { renderDiscountTab() }
        }

        val viewBinding = LayoutTabDiscountBinding.inflate(layoutInflater, binding.frameTabContent, true)
        viewBinding.rvDiscountsList.layoutManager = LinearLayoutManager(this)

        fun loadDiscounts() {
            setLoading(true)
            lifecycleScope.launch {
                val res = apiClient.getDiscounts()
                setLoading(false)

                if (res is NetworkResult.Success) {
                    val discounts = res.data
                    viewBinding.tvDiscountSummary.text = "${discounts.size} Active Coupons"
                    if (discounts.isEmpty()) {
                        viewBinding.tvDiscountsEmpty.visibility = View.VISIBLE
                        viewBinding.rvDiscountsList.visibility = View.GONE
                    } else {
                        viewBinding.tvDiscountsEmpty.visibility = View.GONE
                        viewBinding.rvDiscountsList.visibility = View.VISIBLE
                        viewBinding.rvDiscountsList.adapter = AdminDiscountAdapter(
                            discounts = discounts,
                            onToggleActive = { discount, isActive ->
                                lifecycleScope.launch {
                                    val updRes = apiClient.updateDiscountActive(discount.id, isActive)
                                    if (updRes is NetworkResult.Success) {
                                        Toast.makeText(this@WorkspaceTabActivity, "Coupon ${discount.code} ${if (isActive) "resumed" else "paused"}", Toast.LENGTH_SHORT).show()
                                    } else if (updRes is NetworkResult.Error) {
                                        Toast.makeText(this@WorkspaceTabActivity, updRes.message, Toast.LENGTH_SHORT).show()
                                    }
                                }
                            },
                            onDelete = { discount ->
                                AlertDialog.Builder(this@WorkspaceTabActivity)
                                    .setTitle("Delete Coupon")
                                    .setMessage("Delete promo code ${discount.code}?")
                                    .setPositiveButton("Delete") { _, _ ->
                                        setLoading(true)
                                        lifecycleScope.launch {
                                            val delRes = apiClient.deleteDiscount(discount.id)
                                            setLoading(false)
                                            if (delRes is NetworkResult.Success) {
                                                loadDiscounts()
                                            } else if (delRes is NetworkResult.Error) {
                                                Toast.makeText(this@WorkspaceTabActivity, delRes.message, Toast.LENGTH_SHORT).show()
                                            }
                                        }
                                    }
                                    .setNegativeButton("Cancel", null)
                                    .show()
                            }
                        )
                    }
                } else if (res is NetworkResult.Error) {
                    Toast.makeText(this@WorkspaceTabActivity, res.message, Toast.LENGTH_SHORT).show()
                }
            }
        }

        viewBinding.btnCreateDiscount.setOnClickListener {
            showCreateDiscountDialog {
                loadDiscounts()
            }
        }

        loadDiscounts()
    }

    private fun showCreateDiscountDialog(onCreated: () -> Unit) {
        val etCode = EditText(this).apply { hint = "Coupon Code (e.g. KEBAB25)"; inputType = android.text.InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS }
        val etPct = EditText(this).apply { hint = "Percentage Off (e.g. 20)"; inputType = android.text.InputType.TYPE_CLASS_NUMBER }
        val etMinOrder = EditText(this).apply { hint = "Min Order Value ₹ (e.g. 299)"; inputType = android.text.InputType.TYPE_CLASS_NUMBER }

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 24, 48, 24)
            addView(TextView(context).apply { text = "Create Coupon"; textSize = 18f; typeface = android.graphics.Typeface.DEFAULT_BOLD })
            addView(etCode)
            addView(etPct)
            addView(etMinOrder)
        }

        AlertDialog.Builder(this)
            .setView(layout)
            .setPositiveButton("Create") { _, _ ->
                val code = etCode.text.toString().trim()
                val pct = etPct.text.toString().toDoubleOrNull()
                val minOrder = (etMinOrder.text.toString().toLongOrNull() ?: 0L) * 100L

                if (code.isBlank() || pct == null) {
                    Toast.makeText(this, "Enter valid code and percentage", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }

                setLoading(true)
                lifecycleScope.launch {
                    val res = apiClient.createDiscount(code, pct, null, minOrder)
                    setLoading(false)
                    if (res is NetworkResult.Success) {
                        Toast.makeText(this@WorkspaceTabActivity, "Coupon $code created!", Toast.LENGTH_SHORT).show()
                        onCreated()
                    } else if (res is NetworkResult.Error) {
                        Toast.makeText(this@WorkspaceTabActivity, res.message, Toast.LENGTH_SHORT).show()
                    }
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    // =========================================================================
    // 8. ORDER QUEUE TAB (KDS Kitchen Flow)
    // =========================================================================
    private fun renderOrderQueueTab() {
        binding.tvTabHeaderTitle.text = "Kitchen Pass"
        binding.tvTabHeaderSubtitle.text = "Live KDS tickets & grill station flow"
        setupTopActionButton(R.drawable.ic_refresh) { renderOrderQueueTab() }

        val viewBinding = LayoutTabOrderQueueBinding.inflate(layoutInflater, binding.frameTabContent, true)
        viewBinding.rvKitchenQueue.layoutManager = LinearLayoutManager(this)

        fun loadKitchenQueue() {
            setLoading(true)
            lifecycleScope.launch {
                val res = apiClient.getStaffOrders()
                setLoading(false)

                if (res is NetworkResult.Success) {
                    val activeKitchen = res.data.filter { it.status in listOf("PLACED", "ACCEPTED", "PREPARING") }
                    viewBinding.tvKitchenStatus.text = "${activeKitchen.size} Orders at the Grill Pass"

                    if (activeKitchen.isEmpty()) {
                        viewBinding.tvKitchenEmpty.visibility = View.VISIBLE
                        viewBinding.rvKitchenQueue.visibility = View.GONE
                    } else {
                        viewBinding.tvKitchenEmpty.visibility = View.GONE
                        viewBinding.rvKitchenQueue.visibility = View.VISIBLE
                        viewBinding.rvKitchenQueue.adapter = KitchenQueueAdapter(
                            orders = activeKitchen,
                            onMarkReady = { order ->
                                setLoading(true)
                                lifecycleScope.launch {
                                    val updRes = apiClient.updateStaffOrderStatus(order.orderId, "READY")
                                    setLoading(false)
                                    if (updRes is NetworkResult.Success) {
                                        Toast.makeText(this@WorkspaceTabActivity, "Order #${order.orderId} marked READY for pass!", Toast.LENGTH_SHORT).show()
                                        loadKitchenQueue()
                                    } else if (updRes is NetworkResult.Error) {
                                        Toast.makeText(this@WorkspaceTabActivity, updRes.message, Toast.LENGTH_SHORT).show()
                                    }
                                }
                            },
                            onViewTicket = { order ->
                                showKitchenTicketDialog(order)
                            }
                        )
                    }
                } else if (res is NetworkResult.Error) {
                    Toast.makeText(this@WorkspaceTabActivity, res.message, Toast.LENGTH_SHORT).show()
                }
            }
        }
        loadKitchenQueue()
    }

    private fun showKitchenTicketDialog(order: Order) {
        val lines = order.items.joinToString("\n") {
            val varText = if (!it.variationName.isNullOrBlank()) " (${it.variationName})" else ""
            "• ${it.quantity}× ${it.name}$varText"
        }
        val ticketBody = "KebabZilla Kitchen Ticket\nOrder #${order.orderId}\nCustomer: ${order.customerName ?: "Walk-In"}\nTime: ${order.createdAt ?: "Recently"}\n\n$lines\n\nTotal: ${CurrencyFormatter.formatPaise(order.totalPaise)}"

        AlertDialog.Builder(this)
            .setTitle("KDS Thermal Ticket")
            .setMessage(ticketBody)
            .setPositiveButton("Print Ticket") { dialog, _ ->
                dialog.dismiss()
                Toast.makeText(this, "Sent to thermal kitchen printer!", Toast.LENGTH_SHORT).show()
            }
            .setNegativeButton("Close", null)
            .show()
    }

    // =========================================================================
    // 9. WALK-IN-BILLING TAB (POS Register)
    // =========================================================================
    private fun renderBillingTab() {
        binding.tvTabHeaderTitle.text = "Walk-In POS Billing"
        binding.tvTabHeaderSubtitle.text = "Counter POS register & quick receipts"
        hideTopActionButton()

        val viewBinding = LayoutTabBillingBinding.inflate(layoutInflater, binding.frameTabContent, true)
        val selectedItemsMap = mutableMapOf<MenuItem, Int>()
        var allMenuItems = listOf<MenuItem>()

        fun updateDue() {
            var totalPaise = 0L
            for ((item, qty) in selectedItemsMap) {
                totalPaise += item.displayPricePaise * qty
            }
            viewBinding.tvPosTotalAmount.text = CurrencyFormatter.formatPaise(totalPaise)
        }

        fun populateItems(query: String = "") {
            viewBinding.layoutPosItemsContainer.removeAllViews()
            val filtered = if (query.isNotBlank()) {
                allMenuItems.filter { it.name.contains(query, ignoreCase = true) || it.category.contains(query, ignoreCase = true) }
            } else allMenuItems.take(20)

            for (item in filtered) {
                val row = LinearLayout(this@WorkspaceTabActivity).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = android.view.Gravity.CENTER_VERTICAL
                    setPadding(16, 10, 16, 10)
                    background = ContextCompat.getDrawable(this@WorkspaceTabActivity, R.drawable.bg_pill_white)
                    val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                        bottomMargin = 8
                    }
                    layoutParams = lp
                }
                val tvName = TextView(this@WorkspaceTabActivity).apply {
                    layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                    text = "${item.name} (${CurrencyFormatter.formatPaise(item.displayPricePaise)})"
                    setTextColor(ContextCompat.getColor(context, R.color.brand_ink))
                    textSize = 13f
                    typeface = android.graphics.Typeface.DEFAULT_BOLD
                }

                val currentQty = selectedItemsMap[item] ?: 0
                val tvQty = TextView(this@WorkspaceTabActivity).apply {
                    text = if (currentQty > 0) "$currentQty" else ""
                    textSize = 13f
                    typeface = android.graphics.Typeface.DEFAULT_BOLD
                    setTextColor(ContextCompat.getColor(context, R.color.brand_red))
                    setPadding(12, 0, 12, 0)
                }

                val btnMinus = MaterialButton(this@WorkspaceTabActivity).apply {
                    text = "–"
                    textSize = 12f
                    cornerRadius = (6 * resources.displayMetrics.density).toInt()
                    setBackgroundColor(ContextCompat.getColor(context, R.color.brand_paper))
                    setTextColor(ContextCompat.getColor(context, R.color.brand_ink))
                    val lp = LinearLayout.LayoutParams((36 * resources.displayMetrics.density).toInt(), (36 * resources.displayMetrics.density).toInt())
                    layoutParams = lp
                    setOnClickListener {
                        val curr = selectedItemsMap[item] ?: 0
                        if (curr > 1) {
                            selectedItemsMap[item] = curr - 1
                            tvQty.text = "${curr - 1}"
                        } else {
                            selectedItemsMap.remove(item)
                            tvQty.text = ""
                        }
                        updateDue()
                    }
                }

                val btnPlus = MaterialButton(this@WorkspaceTabActivity).apply {
                    text = "+"
                    textSize = 12f
                    cornerRadius = (6 * resources.displayMetrics.density).toInt()
                    setBackgroundColor(ContextCompat.getColor(context, R.color.brand_red))
                    setTextColor(ContextCompat.getColor(context, R.color.white))
                    val lp = LinearLayout.LayoutParams((36 * resources.displayMetrics.density).toInt(), (36 * resources.displayMetrics.density).toInt()).apply {
                        marginStart = 4
                    }
                    layoutParams = lp
                    setOnClickListener {
                        val curr = selectedItemsMap[item] ?: 0
                        selectedItemsMap[item] = curr + 1
                        tvQty.text = "${curr + 1}"
                        updateDue()
                    }
                }

                row.addView(tvName)
                row.addView(btnMinus)
                row.addView(tvQty)
                row.addView(btnPlus)
                viewBinding.layoutPosItemsContainer.addView(row)
            }
        }

        viewBinding.etPosDishSearch.setOnEditorActionListener { _, _, _ ->
            populateItems(viewBinding.etPosDishSearch.text.toString().trim())
            true
        }

        setLoading(true)
        lifecycleScope.launch {
            val res = apiClient.getAllMenuItemsCombined()
            setLoading(false)

            if (res is NetworkResult.Success) {
                allMenuItems = res.data.filter { it.isAvailable && !it.isPaused }
                populateItems()
            }
        }

        viewBinding.btnPosClear.setOnClickListener {
            selectedItemsMap.clear()
            viewBinding.etPosCustomerName.setText("")
            viewBinding.etPosCustomerPhone.setText("")
            populateItems(viewBinding.etPosDishSearch.text.toString().trim())
            updateDue()
            Toast.makeText(this, "Ticket cleared", Toast.LENGTH_SHORT).show()
        }

        viewBinding.btnGeneratePosBill.setOnClickListener {
            if (selectedItemsMap.isEmpty()) {
                Toast.makeText(this, "Please select dishes to bill", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            val customer = viewBinding.etPosCustomerName.text.toString().trim().ifBlank { "Walk-In Guest" }
            val phone = viewBinding.etPosCustomerPhone.text.toString().trim().takeIf { it.isNotBlank() }

            val cartLines = selectedItemsMap.map { (item, qty) ->
                CartLine(menuItem = item, quantity = qty)
            }

            setLoading(true)
            lifecycleScope.launch {
                val res = apiClient.createWalkInOrder(customer, phone, cartLines)
                setLoading(false)

                if (res is NetworkResult.Success) {
                    val order = res.data
                    val linesSummary = order.items.joinToString("\n") { "• ${it.quantity}× ${it.name} — ${CurrencyFormatter.formatPaise(it.lineTotalPaise)}" }
                    val receiptMsg = "Receipt #${order.orderId}\nCustomer: ${order.customerName}\nPayment: Cash\n\n$linesSummary\n\nTotal Paid: ${CurrencyFormatter.formatPaise(order.totalPaise)}"

                    AlertDialog.Builder(this@WorkspaceTabActivity)
                        .setTitle("Receipt Generated")
                        .setMessage(receiptMsg)
                        .setPositiveButton("Print Receipt") { dialog, _ ->
                            dialog.dismiss()
                            Toast.makeText(this@WorkspaceTabActivity, "Printing receipt...", Toast.LENGTH_SHORT).show()
                            selectedItemsMap.clear()
                            viewBinding.etPosCustomerName.setText("")
                            viewBinding.etPosCustomerPhone.setText("")
                            populateItems()
                            updateDue()
                        }
                        .setNegativeButton("New Bill") { dialog, _ ->
                            dialog.dismiss()
                            selectedItemsMap.clear()
                            viewBinding.etPosCustomerName.setText("")
                            viewBinding.etPosCustomerPhone.setText("")
                            populateItems()
                            updateDue()
                        }
                        .show()
                } else if (res is NetworkResult.Error) {
                    Toast.makeText(this@WorkspaceTabActivity, res.message, Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    // =========================================================================
    // 10. MENU AVAILABILITY TAB (86 Station)
    // =========================================================================
    private fun renderMenuAvailabilityTab() {
        binding.tvTabHeaderTitle.text = "Menu Availability"
        binding.tvTabHeaderSubtitle.text = "Real-time 86 list, pause items & daily stock"
        setupTopActionButton(R.drawable.ic_refresh) { renderMenuAvailabilityTab() }

        val viewBinding = LayoutTabMenuAvailabilityBinding.inflate(layoutInflater, binding.frameTabContent, true)
        viewBinding.rvAvailabilityItems.layoutManager = LinearLayoutManager(this)

        var allItems = listOf<MenuItem>()
        var selectedCategory = "All"

        fun filterAndShow(query: String = "") {
            var filtered = if (selectedCategory != "All") {
                allItems.filter { it.category.equals(selectedCategory, ignoreCase = true) }
            } else allItems

            if (query.isNotBlank()) {
                filtered = filtered.filter { it.name.contains(query, ignoreCase = true) }
            }

            if (filtered.isEmpty()) {
                viewBinding.tvAvailabilityEmpty.visibility = View.VISIBLE
                viewBinding.rvAvailabilityItems.visibility = View.GONE
            } else {
                viewBinding.tvAvailabilityEmpty.visibility = View.GONE
                viewBinding.rvAvailabilityItems.visibility = View.VISIBLE
                viewBinding.rvAvailabilityItems.adapter = AdminMenuAdapter(
                    items = filtered,
                    onStockToggle = { item, isAvailable ->
                        lifecycleScope.launch {
                            val toggleRes = apiClient.toggleMenuPause(item.id.toString(), !isAvailable)
                            if (toggleRes is NetworkResult.Success) {
                                Toast.makeText(
                                    this@WorkspaceTabActivity,
                                    "${item.name} ${if (isAvailable) "restocked (Live)" else "paused (86ed)"}",
                                    Toast.LENGTH_SHORT
                                ).show()
                            } else if (toggleRes is NetworkResult.Error) {
                                Toast.makeText(this@WorkspaceTabActivity, toggleRes.message, Toast.LENGTH_SHORT).show()
                            }
                        }
                    },
                    onItemClick = {}
                )
            }
        }

        fun setupCategories(categories: List<String>) {
            viewBinding.layoutAvailabilityCategoryChips.removeAllViews()
            val list = listOf("All") + categories
            for (cat in list) {
                val chip = TextView(this).apply {
                    text = cat
                    setPadding(28, 14, 28, 14)
                    textSize = 12f
                    typeface = android.graphics.Typeface.DEFAULT_BOLD
                    val isSelected = cat == selectedCategory
                    background = ContextCompat.getDrawable(
                        this@WorkspaceTabActivity,
                        if (isSelected) R.drawable.bg_pill_primary else R.drawable.bg_pill_white
                    )
                    setTextColor(
                        ContextCompat.getColor(
                            this@WorkspaceTabActivity,
                            if (isSelected) R.color.white else R.color.brand_muted
                        )
                    )
                    val lp = LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.WRAP_CONTENT,
                        ViewGroup.LayoutParams.WRAP_CONTENT
                    ).apply { marginEnd = 16 }
                    layoutParams = lp
                    setOnClickListener {
                        selectedCategory = cat
                        setupCategories(categories)
                        filterAndShow(viewBinding.etAvailabilitySearch.text.toString().trim())
                    }
                }
                viewBinding.layoutAvailabilityCategoryChips.addView(chip)
            }
        }

        setLoading(true)
        lifecycleScope.launch {
            val menuRes = apiClient.getAllMenuItemsCombined()
            val pausesRes = apiClient.getMenuPauses()
            setLoading(false)

            if (menuRes is NetworkResult.Success) {
                val pausedIds = (pausesRes as? NetworkResult.Success)?.data?.map { it.menuItemId }?.toSet() ?: emptySet()
                allItems = menuRes.data.map { item ->
                    item.copy(isPaused = pausedIds.contains(item.id.toString()) || item.isPaused)
                }

                val categories = allItems.map { it.category }.distinct().filter { it.isNotBlank() }
                setupCategories(categories)
                filterAndShow()
            }
        }

        viewBinding.etAvailabilitySearch.setOnEditorActionListener { _, _, _ ->
            filterAndShow(viewBinding.etAvailabilitySearch.text.toString().trim())
            true
        }
    }

    // =========================================================================
    // 11. DELIVERY QUEUE TAB (ALNS Fleet & OTP)
    // =========================================================================
    private fun renderDeliveryQueueTab() {
        binding.tvTabHeaderTitle.text = "Deliveries & Logistics"
        binding.tvTabHeaderSubtitle.text = "Rider waypoint routes, live duty & completion OTP"
        setupTopActionButton(R.drawable.ic_refresh) { renderDeliveryQueueTab() }

        val viewBinding = LayoutTabDeliveryQueueBinding.inflate(layoutInflater, binding.frameTabContent, true)
        viewBinding.rvDeliveryOrders.layoutManager = LinearLayoutManager(this)
        viewBinding.rvPastDeliveries.layoutManager = LinearLayoutManager(this)

        var activeTab = "CURRENT" // "CURRENT" or "PAST"
        var activeOrdersList = listOf<Order>()
        var pastOrdersList = listOf<Order>()

        fun updateSubTabUI() {
            if (activeTab == "CURRENT") {
                viewBinding.btnDeliverySubTabCurrent.background = ContextCompat.getDrawable(this, R.drawable.bg_pill_primary)
                viewBinding.btnDeliverySubTabCurrent.setTextColor(ContextCompat.getColor(this, R.color.white))
                viewBinding.btnDeliverySubTabPast.background = null
                viewBinding.btnDeliverySubTabPast.setTextColor(ContextCompat.getColor(this, R.color.brand_muted))
                viewBinding.layoutDeliveryCurrentSection.visibility = View.VISIBLE
                viewBinding.layoutDeliveryPastSection.visibility = View.GONE
            } else {
                viewBinding.btnDeliverySubTabPast.background = ContextCompat.getDrawable(this, R.drawable.bg_pill_primary)
                viewBinding.btnDeliverySubTabPast.setTextColor(ContextCompat.getColor(this, R.color.white))
                viewBinding.btnDeliverySubTabCurrent.background = null
                viewBinding.btnDeliverySubTabCurrent.setTextColor(ContextCompat.getColor(this, R.color.brand_muted))
                viewBinding.layoutDeliveryPastSection.visibility = View.VISIBLE
                viewBinding.layoutDeliveryCurrentSection.visibility = View.GONE
            }
        }

        fun filterPastOrders(query: String) {
            val q = query.trim().lowercase()
            val filtered = if (q.isBlank()) {
                pastOrdersList
            } else {
                pastOrdersList.filter {
                    it.orderId.lowercase().contains(q) ||
                    (it.customerName?.lowercase()?.contains(q) == true) ||
                    (it.address?.lowercase()?.contains(q) == true)
                }
            }
            if (filtered.isEmpty()) {
                viewBinding.tvPastDeliveryEmpty.visibility = View.VISIBLE
                viewBinding.rvPastDeliveries.visibility = View.GONE
            } else {
                viewBinding.tvPastDeliveryEmpty.visibility = View.GONE
                viewBinding.rvPastDeliveries.visibility = View.VISIBLE
                viewBinding.rvPastDeliveries.adapter = PastDeliveryAdapter(filtered)
            }
        }

        fun loadPastDeliveries() {
            lifecycleScope.launch {
                val res = apiClient.getDeliveryHistory()
                if (res is NetworkResult.Success) {
                    pastOrdersList = res.data
                    viewBinding.tvPastDeliveriesCount.text = res.data.size.toString()
                    val totalRev = res.data.sumOf { it.totalPaise }
                    viewBinding.tvPastDeliveriesRevenue.text = CurrencyFormatter.formatPaise(totalRev)
                    filterPastOrders(viewBinding.etPastDeliveriesSearch.text?.toString() ?: "")
                }
            }
        }

        viewBinding.btnDeliverySubTabCurrent.setOnClickListener {
            activeTab = "CURRENT"
            updateSubTabUI()
        }

        viewBinding.btnDeliverySubTabPast.setOnClickListener {
            activeTab = "PAST"
            updateSubTabUI()
            if (pastOrdersList.isEmpty()) {
                loadPastDeliveries()
            }
        }

        viewBinding.etPastDeliveriesSearch.doAfterTextChanged {
            filterPastOrders(it?.toString() ?: "")
        }

        fun loadDutyStatus() {
            lifecycleScope.launch {
                val res = apiClient.getDriverDutyStatus()
                if (res is NetworkResult.Success) {
                    val duty = res.data
                    viewBinding.switchDriverDuty.setOnCheckedChangeListener(null)
                    viewBinding.switchDriverDuty.isChecked = duty.isAcceptingDeliveries
                    viewBinding.tvDutySubtitle.text = "${duty.scheduleStatus ?: "Operating hours open"} · ${duty.activeRiders} active riders on road"
                    viewBinding.switchDriverDuty.setOnCheckedChangeListener { _, isChecked ->
                        lifecycleScope.launch {
                            val updRes = apiClient.updateDriverDutyStatus(isChecked)
                            if (updRes is NetworkResult.Success) {
                                Toast.makeText(this@WorkspaceTabActivity, if (isChecked) "You are now accepting deliveries" else "You are off duty", Toast.LENGTH_SHORT).show()
                                loadDutyStatus()
                            } else if (updRes is NetworkResult.Error) {
                                viewBinding.switchDriverDuty.isChecked = !isChecked
                                Toast.makeText(this@WorkspaceTabActivity, updRes.message, Toast.LENGTH_SHORT).show()
                            }
                        }
                    }
                }
            }
        }

        fun loadDeliveries() {
            setLoading(true)
            lifecycleScope.launch {
                val res = apiClient.getStaffOrders()
                setLoading(false)

                if (res is NetworkResult.Success) {
                    val deliveryOrders = res.data.filter { it.status in listOf("READY", "OUT_FOR_DELIVERY") }
                    activeOrdersList = deliveryOrders

                    if (deliveryOrders.isEmpty()) {
                        viewBinding.tvDeliveryEmpty.visibility = View.VISIBLE
                        viewBinding.rvDeliveryOrders.visibility = View.GONE
                        viewBinding.cardDeliveryWaypoints.visibility = View.GONE
                    } else {
                        viewBinding.tvDeliveryEmpty.visibility = View.GONE
                        viewBinding.rvDeliveryOrders.visibility = View.VISIBLE
                        viewBinding.cardDeliveryWaypoints.visibility = View.VISIBLE
                        viewBinding.tvWaypointsSummary.text = "Origin: KebabZilla Restaurant · ${deliveryOrders.size} stop${if (deliveryOrders.size == 1) "" else "s"} in delivery sequence"

                        viewBinding.btnOpenMultiStopNav.setOnClickListener {
                            val lastOrder = deliveryOrders.last()
                            val dest = if (lastOrder.latitude != null && lastOrder.longitude != null) {
                                "${lastOrder.latitude},${lastOrder.longitude}"
                            } else {
                                Uri.encode(lastOrder.address ?: "")
                            }

                            val intermediate = deliveryOrders.dropLast(1).map { o ->
                                if (o.latitude != null && o.longitude != null) "${o.latitude},${o.longitude}" else Uri.encode(o.address ?: "")
                            }.filter { it.isNotBlank() }

                            val waypointsParam = if (intermediate.isNotEmpty()) "&waypoints=${intermediate.joinToString("|")}" else ""
                            val navUrl = "https://www.google.com/maps/dir/?api=1&destination=$dest$waypointsParam"
                            try {
                                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(navUrl)))
                            } catch (e: Exception) {
                                Toast.makeText(this@WorkspaceTabActivity, "Could not open Google Maps", Toast.LENGTH_SHORT).show()
                            }
                        }

                        viewBinding.rvDeliveryOrders.adapter = DeliveryQueueAdapter(
                            orders = deliveryOrders,
                            onVerifyOtp = { order ->
                                viewBinding.etDeliveryOrderId.setText(order.orderId)
                                viewBinding.etDeliveryOtp.requestFocus()
                            },
                            onCallCustomer = { order ->
                                if (!order.customerPhone.isNullOrBlank()) {
                                    val dialIntent = Intent(Intent.ACTION_DIAL, Uri.parse("tel:${order.customerPhone}"))
                                    startActivity(dialIntent)
                                } else {
                                    Toast.makeText(this@WorkspaceTabActivity, "No phone number available", Toast.LENGTH_SHORT).show()
                                }
                            },
                            onUnassignRider = { order ->
                                AlertDialog.Builder(this@WorkspaceTabActivity)
                                    .setTitle("Unassign Driver")
                                    .setMessage("Unassign driver and return Order #${order.orderId} to ready pool?")
                                    .setPositiveButton("Unassign") { _, _ ->
                                        setLoading(true)
                                        lifecycleScope.launch {
                                            val unRes = apiClient.unassignDelivery(order.orderId)
                                            setLoading(false)
                                            if (unRes is NetworkResult.Success) {
                                                Toast.makeText(this@WorkspaceTabActivity, "Driver unassigned", Toast.LENGTH_SHORT).show()
                                                loadDeliveries()
                                            } else if (unRes is NetworkResult.Error) {
                                                Toast.makeText(this@WorkspaceTabActivity, unRes.message, Toast.LENGTH_SHORT).show()
                                            }
                                        }
                                    }
                                    .setNegativeButton("Cancel", null)
                                    .show()
                            },
                            onNavigate = { order ->
                                val dest = if (order.latitude != null && order.longitude != null) {
                                    "${order.latitude},${order.longitude}"
                                } else {
                                    Uri.encode(order.address ?: "")
                                }
                                val url = "https://www.google.com/maps/dir/?api=1&destination=$dest"
                                try {
                                    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                                } catch (e: Exception) {
                                    Toast.makeText(this@WorkspaceTabActivity, "Could not open Google Maps", Toast.LENGTH_SHORT).show()
                                }
                            }
                        )
                    }
                }
            }
        }

        viewBinding.btnVerifyOtpSubmit.setOnClickListener {
            val orderId = viewBinding.etDeliveryOrderId.text.toString().trim()
            val otp = viewBinding.etDeliveryOtp.text.toString().trim()
            if (orderId.isBlank() || otp.length < 6) {
                Toast.makeText(this, "Enter Order ID & 6-digit OTP", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            setLoading(true)
            lifecycleScope.launch {
                val res = apiClient.verifyDeliveryOtp(orderId, otp)
                setLoading(false)
                if (res is NetworkResult.Success) {
                    Toast.makeText(this@WorkspaceTabActivity, "Order #$orderId marked DELIVERED successfully!", Toast.LENGTH_LONG).show()
                    viewBinding.etDeliveryOrderId.setText("")
                    viewBinding.etDeliveryOtp.setText("")
                    loadDeliveries()
                    if (activeTab == "PAST") loadPastDeliveries()
                } else if (res is NetworkResult.Error) {
                    Toast.makeText(this@WorkspaceTabActivity, res.message, Toast.LENGTH_SHORT).show()
                }
            }
        }

        loadDutyStatus()
        loadDeliveries()
    }

    // =========================================================================
    // 12. SALES REPORTS TAB (Revenue, GST & Channels)
    // =========================================================================
    private fun renderReportsTab() {
        binding.tvTabHeaderTitle.text = "Sales & Analytics"
        binding.tvTabHeaderSubtitle.text = "Daily revenue, fulfillment channels & shift analytics"
        setupTopActionButton(R.drawable.ic_refresh) { renderReportsTab() }

        val viewBinding = LayoutTabReportsBinding.inflate(layoutInflater, binding.frameTabContent, true)
        var selectedPeriod = "today"

        fun updatePeriodUI() {
            val pills = listOf(
                viewBinding.btnPeriodToday to "today",
                viewBinding.btnPeriodWeek to "week",
                viewBinding.btnPeriodMonth to "month",
                viewBinding.btnPeriodYear to "year"
            )
            for ((btn, key) in pills) {
                val isSel = selectedPeriod == key
                btn.background = if (isSel) ContextCompat.getDrawable(this, R.drawable.bg_pill_primary) else null
                btn.setTextColor(ContextCompat.getColor(this, if (isSel) R.color.white else R.color.brand_muted))
            }
        }

        fun loadReport(period: String) {
            setLoading(true)
            lifecycleScope.launch {
                val res = apiClient.getSalesReport(period)
                setLoading(false)

                if (res is NetworkResult.Success) {
                    val report = res.data
                    viewBinding.tvReportRevenue.text = CurrencyFormatter.formatPaise(report.revenuePaise)
                    viewBinding.tvReportRevenuePeriod.text = "For ${period.replaceFirstChar { it.uppercase() }} ↗"
                    viewBinding.tvReportPaidOrdersCount.text = report.paidOrders.toString()
                    viewBinding.tvReportPaidOrdersSubtext.text = "${report.totalOrders} placed in this period"

                    viewBinding.tvReportAov.text = CurrencyFormatter.formatPaise(report.averageOrderPaise)
                    val successRate = if (report.totalOrders > 0) "${(report.paidOrders * 100) / report.totalOrders}%" else "100%"
                    viewBinding.tvReportSuccessRate.text = successRate

                    // Fulfillment channels
                    viewBinding.tvReportDeliveryOrders.text = "${report.deliveryOrders} orders · ${CurrencyFormatter.formatPaise(report.deliveryRevenuePaise)}"
                    viewBinding.tvReportWalkInOrders.text = "${report.dineInOrders} orders · ${CurrencyFormatter.formatPaise(report.dineInRevenuePaise)}"

                    // Reconciliation & GST
                    viewBinding.tvReportOnlineRev.text = "${CurrencyFormatter.formatPaise(report.onlineRevenuePaise)} (${report.onlineOrders})"
                    viewBinding.tvReportCashRev.text = "${CurrencyFormatter.formatPaise(report.cashRevenuePaise)} (${report.cashOrders})"
                    val gstPaise = (report.revenuePaise * 5) / 105
                    viewBinding.tvReportGst.text = CurrencyFormatter.formatPaise(gstPaise)

                    // Statuses pipeline
                    viewBinding.layoutReportStatuses.removeAllViews()
                    if (report.statuses.isEmpty()) {
                        viewBinding.layoutReportStatuses.addView(TextView(this@WorkspaceTabActivity).apply {
                            text = "No orders recorded in this period."
                            setTextColor(ContextCompat.getColor(context, R.color.brand_muted))
                            textSize = 12f
                        })
                    } else {
                        for ((st, cnt) in report.statuses) {
                            val row = LinearLayout(this@WorkspaceTabActivity).apply {
                                orientation = LinearLayout.HORIZONTAL
                                gravity = android.view.Gravity.CENTER_VERTICAL
                                setPadding(0, 10, 0, 10)
                                addView(TextView(context).apply {
                                    text = st.replace("_", " ")
                                    textSize = 12f
                                    typeface = android.graphics.Typeface.DEFAULT_BOLD
                                    setTextColor(ContextCompat.getColor(context, R.color.brand_ink))
                                    layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                                })
                                addView(TextView(context).apply {
                                    text = "$cnt order${if (cnt == 1) "" else "s"}"
                                    textSize = 12f
                                    setTextColor(ContextCompat.getColor(context, R.color.brand_muted))
                                })
                            }
                            viewBinding.layoutReportStatuses.addView(row)
                        }
                    }

                    // Top items
                    viewBinding.layoutReportTopSellers.removeAllViews()
                    if (report.topItems.isEmpty()) {
                        viewBinding.layoutReportTopSellers.addView(TextView(this@WorkspaceTabActivity).apply {
                            text = "No item sales in this period."
                            setTextColor(ContextCompat.getColor(context, R.color.brand_muted))
                            textSize = 12f
                        })
                    } else {
                        report.topItems.forEachIndexed { idx, item ->
                            val card = com.google.android.material.card.MaterialCardView(this@WorkspaceTabActivity).apply {
                                radius = 12 * resources.displayMetrics.density
                                strokeColor = ContextCompat.getColor(context, R.color.brand_line)
                                strokeWidth = (1 * resources.displayMetrics.density).toInt()
                                setCardBackgroundColor(ContextCompat.getColor(context, R.color.brand_paper_card))
                                val inner = LinearLayout(context).apply {
                                    orientation = LinearLayout.HORIZONTAL
                                    gravity = android.view.Gravity.CENTER_VERTICAL
                                    setPadding(24, 18, 24, 18)
                                    addView(TextView(context).apply {
                                        text = "#${idx + 1}"
                                        textSize = 12f
                                        typeface = android.graphics.Typeface.DEFAULT_BOLD
                                        setTextColor(ContextCompat.getColor(context, R.color.brand_red))
                                        setPadding(0, 0, 20, 0)
                                    })
                                    addView(TextView(context).apply {
                                        text = item.name
                                        textSize = 13f
                                        typeface = android.graphics.Typeface.DEFAULT_BOLD
                                        setTextColor(ContextCompat.getColor(context, R.color.brand_ink))
                                        layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                                    })
                                    addView(TextView(context).apply {
                                        text = "${item.quantity} sold"
                                        textSize = 11f
                                        typeface = android.graphics.Typeface.DEFAULT_BOLD
                                        background = ContextCompat.getDrawable(context, R.drawable.bg_pill_white)
                                        setPadding(16, 6, 16, 6)
                                        setTextColor(ContextCompat.getColor(context, R.color.brand_ink))
                                    })
                                }
                                addView(inner)
                                val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                                    bottomMargin = 10
                                }
                                layoutParams = lp
                            }
                            viewBinding.layoutReportTopSellers.addView(card)
                        }
                    }
                } else if (res is NetworkResult.Error) {
                    Toast.makeText(this@WorkspaceTabActivity, res.message, Toast.LENGTH_SHORT).show()
                }
            }
        }

        viewBinding.btnPeriodToday.setOnClickListener { selectedPeriod = "today"; updatePeriodUI(); loadReport("today") }
        viewBinding.btnPeriodWeek.setOnClickListener { selectedPeriod = "week"; updatePeriodUI(); loadReport("week") }
        viewBinding.btnPeriodMonth.setOnClickListener { selectedPeriod = "month"; updatePeriodUI(); loadReport("month") }
        viewBinding.btnPeriodYear.setOnClickListener { selectedPeriod = "year"; updatePeriodUI(); loadReport("year") }

        updatePeriodUI()
        loadReport("today")
    }

    // =========================================================================
    // 13. RESTAURANT SETTINGS TAB (Hours, Geofence, Master Switches)
    // =========================================================================
    private fun renderSettingsTab() {
        binding.tvTabHeaderTitle.text = "Restaurant Settings"
        binding.tvTabHeaderSubtitle.text = "Store hours, geofence & payment rails"
        setupTopActionButton(R.drawable.ic_refresh) { renderSettingsTab() }

        val viewBinding = LayoutTabSettingsBinding.inflate(layoutInflater, binding.frameTabContent, true)
        var currentSettings = AdminRestaurantSettings()

        setLoading(true)
        lifecycleScope.launch {
            val res = apiClient.getAdminSettings()
            setLoading(false)

            if (res is NetworkResult.Success) {
                currentSettings = res.data
                viewBinding.switchRestaurantOpen.isChecked = currentSettings.isOpen
                viewBinding.switchDeliveryActive.isChecked = currentSettings.isDeliveryEnabled
                viewBinding.etSettingsName.setText(currentSettings.restaurantName)
                viewBinding.etSettingsTagline.setText(currentSettings.tagline)
                viewBinding.etSettingsOpenTime.setText(currentSettings.openTime ?: "11:00")
                viewBinding.etSettingsCloseTime.setText(currentSettings.closeTime ?: "23:00")
                viewBinding.etSettingsPhone.setText(currentSettings.phone ?: "+91 9876543210")
                viewBinding.etSettingsRadius.setText(currentSettings.deliveryRadiusKm.toString())
                viewBinding.etSettingsFreeRadius.setText(currentSettings.freeDeliveryRadiusKm.toString())
            }
        }

        viewBinding.btnSaveSettings.setOnClickListener {
            val updated = currentSettings.copy(
                isOpen = viewBinding.switchRestaurantOpen.isChecked,
                isDeliveryEnabled = viewBinding.switchDeliveryActive.isChecked,
                restaurantName = viewBinding.etSettingsName.text.toString().trim().ifBlank { "KebabZilla" },
                tagline = viewBinding.etSettingsTagline.text.toString().trim(),
                openTime = viewBinding.etSettingsOpenTime.text.toString().trim(),
                closeTime = viewBinding.etSettingsCloseTime.text.toString().trim(),
                phone = viewBinding.etSettingsPhone.text.toString().trim(),
                deliveryRadiusKm = viewBinding.etSettingsRadius.text.toString().toDoubleOrNull() ?: 15.0,
                freeDeliveryRadiusKm = viewBinding.etSettingsFreeRadius.text.toString().toDoubleOrNull() ?: 2.0
            )

            setLoading(true)
            lifecycleScope.launch {
                val res = apiClient.updateAdminSettings(updated)
                setLoading(false)
                if (res is NetworkResult.Success) {
                    currentSettings = updated
                    Toast.makeText(this@WorkspaceTabActivity, "Restaurant settings saved!", Toast.LENGTH_LONG).show()
                } else if (res is NetworkResult.Error) {
                    Toast.makeText(this@WorkspaceTabActivity, res.message, Toast.LENGTH_SHORT).show()
                }
            }
        }
    }
}

// =============================================================================
// RECYCLERVIEW ADAPTERS FOR TABS
// =============================================================================

class AdminOrderAdapter(
    private val orders: List<Order>,
    private val onAdvanceStatus: (Order) -> Unit,
    private val onChangeStatus: (Order) -> Unit,
    private val onRefund: (Order) -> Unit,
    private val onOrderClick: (Order) -> Unit
) : RecyclerView.Adapter<AdminOrderAdapter.Holder>() {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
        val b = ItemAdminOrderCardBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return Holder(b)
    }

    override fun onBindViewHolder(holder: Holder, position: Int) = holder.bind(orders[position])
    override fun getItemCount() = orders.size

    inner class Holder(private val b: ItemAdminOrderCardBinding) : RecyclerView.ViewHolder(b.root) {
        fun bind(o: Order) {
            b.tvOrderCardId.text = "Order #${o.orderId}"
            b.tvOrderCardStatusBadge.text = o.status
            b.tvOrderCustomerAndDate.text = "${o.customerName ?: "Customer"} (${o.customerPhone?.ifBlank { "Delivery" } ?: "Delivery"}) · ${o.createdAt ?: "Recently"}"
            b.tvOrderAddress.text = o.address ?: "Restaurant Counter"
            b.tvOrderTotalAmount.text = "${CurrencyFormatter.formatPaise(o.totalPaise)} (${o.paymentMethod ?: "COD"})"

            val itemsSummary = o.items.joinToString(", ") { "${it.quantity}× ${it.name}" }
            b.tvOrderItemsSummary.text = itemsSummary.ifBlank { "Standard Order" }

            val nextAction = when (o.status) {
                "PLACED" -> "Accept"
                "ACCEPTED" -> "Start Grill"
                "PREPARING" -> "Mark Ready"
                "READY" -> "Dispatch"
                "OUT_FOR_DELIVERY" -> "Delivered"
                else -> null
            }

            if (nextAction != null) {
                b.btnOrderStatusAction.visibility = View.VISIBLE
                b.btnOrderStatusAction.text = nextAction
                b.btnOrderStatusAction.setOnClickListener { onAdvanceStatus(o) }
            } else {
                b.btnOrderStatusAction.visibility = View.GONE
            }

            b.btnOrderStatusChange.setOnClickListener { onChangeStatus(o) }

            if (o.status != "CANCELLED" && o.status != "DELIVERED") {
                b.btnOrderRefund.visibility = View.VISIBLE
                b.btnOrderRefund.setOnClickListener { onRefund(o) }
            } else {
                b.btnOrderRefund.visibility = View.GONE
            }

            b.root.setOnClickListener { onOrderClick(o) }
        }
    }
}

class AdminMenuAdapter(
    private val items: List<MenuItem>,
    private val onStockToggle: (MenuItem, Boolean) -> Unit,
    private val onItemClick: (MenuItem) -> Unit
) : RecyclerView.Adapter<AdminMenuAdapter.Holder>() {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
        val b = ItemAdminMenuCardBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return Holder(b)
    }

    override fun onBindViewHolder(holder: Holder, position: Int) = holder.bind(items[position])
    override fun getItemCount() = items.size

    inner class Holder(private val b: ItemAdminMenuCardBinding) : RecyclerView.ViewHolder(b.root) {
        fun bind(item: MenuItem) {
            b.tvMenuItemName.text = item.name
            b.tvMenuItemCategoryPrice.text = "${item.category} · ${CurrencyFormatter.formatPaise(item.displayPricePaise)}"
            b.ivMenuVegBadge.setImageResource(if (item.isVegetarian) R.drawable.ic_veg else R.drawable.ic_non_veg)

            if (!item.imageUrl.isNullOrBlank()) {
                b.ivMenuItemThumb.load(item.imageUrl) {
                    crossfade(true)
                }
            } else {
                b.ivMenuItemThumb.setImageResource(R.drawable.kebabzilla_mark)
            }

            val isInStock = !item.isPaused && item.isAvailable
            b.switchMenuItemStock.setOnCheckedChangeListener(null)
            b.switchMenuItemStock.isChecked = isInStock
            b.tvMenuItemStockStatus.text = if (isInStock) "In Stock (Live)" else "Paused (86ed)"
            b.tvMenuItemStockStatus.setTextColor(ContextCompat.getColor(b.root.context, if (isInStock) R.color.brand_emerald else R.color.brand_error))

            b.switchMenuItemStock.setOnCheckedChangeListener { _, isChecked ->
                b.tvMenuItemStockStatus.text = if (isChecked) "In Stock (Live)" else "Paused (86ed)"
                b.tvMenuItemStockStatus.setTextColor(ContextCompat.getColor(b.root.context, if (isChecked) R.color.brand_emerald else R.color.brand_error))
                onStockToggle(item, isChecked)
            }

            b.root.setOnClickListener { onItemClick(item) }
        }
    }
}

class AdminStaffAdapter(
    private val staff: List<AdminAccount>,
    private val onStaffClick: (AdminAccount) -> Unit
) : RecyclerView.Adapter<AdminStaffAdapter.Holder>() {
    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) = Holder(ItemAdminStaffCardBinding.inflate(LayoutInflater.from(parent.context), parent, false))
    override fun onBindViewHolder(holder: Holder, position: Int) = holder.bind(staff[position])
    override fun getItemCount() = staff.size

    inner class Holder(private val b: ItemAdminStaffCardBinding) : RecyclerView.ViewHolder(b.root) {
        fun bind(s: AdminAccount) {
            b.tvStaffName.text = s.name
            b.tvStaffEmail.text = s.email
            b.tvStaffPhone.text = s.phone ?: "Phone not registered"
            b.tvStaffRoleBadge.text = s.role
            val initials = s.name.split(" ").mapNotNull { it.firstOrNull()?.toString() }.take(2).joinToString("").uppercase()
            b.tvStaffInitials.text = initials.ifBlank { "KZ" }
            b.root.setOnClickListener { onStaffClick(s) }
        }
    }
}

class AdminEventAdapter(private val events: List<AdminEvent>) : RecyclerView.Adapter<AdminEventAdapter.Holder>() {
    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) = Holder(ItemAdminEventCardBinding.inflate(LayoutInflater.from(parent.context), parent, false))
    override fun onBindViewHolder(holder: Holder, position: Int) = holder.bind(events[position])
    override fun getItemCount() = events.size

    inner class Holder(private val b: ItemAdminEventCardBinding) : RecyclerView.ViewHolder(b.root) {
        fun bind(e: AdminEvent) {
            b.tvEventType.text = e.eventType
            b.tvEventDescription.text = e.description
            b.tvEventActor.text = "Actor: ${e.actorName ?: e.actorEmail ?: "System"}"
            b.tvEventTime.text = e.createdAt ?: "Recently"
        }
    }
}

class AdminDiscountAdapter(
    private val discounts: List<MenuDiscount>,
    private val onToggleActive: (MenuDiscount, Boolean) -> Unit,
    private val onDelete: (MenuDiscount) -> Unit
) : RecyclerView.Adapter<AdminDiscountAdapter.Holder>() {
    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) = Holder(ItemAdminDiscountCardBinding.inflate(LayoutInflater.from(parent.context), parent, false))
    override fun onBindViewHolder(holder: Holder, position: Int) = holder.bind(discounts[position])
    override fun getItemCount() = discounts.size

    inner class Holder(private val b: ItemAdminDiscountCardBinding) : RecyclerView.ViewHolder(b.root) {
        fun bind(d: MenuDiscount) {
            b.tvDiscountCode.text = d.code
            b.tvDiscountValueBadge.text = if (d.percentage != null) "${d.percentage}% OFF" else "${CurrencyFormatter.formatPaise(d.flatAmountPaise ?: 0L)} FLAT OFF"
            b.tvDiscountConditions.text = if (d.minOrderPaise > 0) "Valid on orders above ${CurrencyFormatter.formatPaise(d.minOrderPaise)}" else "No minimum order requirement"

            b.switchDiscountActive.setOnCheckedChangeListener(null)
            b.switchDiscountActive.isChecked = d.isActive
            b.switchDiscountActive.setOnCheckedChangeListener { _, isChecked ->
                onToggleActive(d, isChecked)
            }

            b.btnDeleteDiscount.setOnClickListener { onDelete(d) }
        }
    }
}

class KitchenQueueAdapter(
    private val orders: List<Order>,
    private val onMarkReady: (Order) -> Unit,
    private val onViewTicket: (Order) -> Unit
) : RecyclerView.Adapter<KitchenQueueAdapter.Holder>() {
    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) = Holder(ItemKitchenQueueCardBinding.inflate(LayoutInflater.from(parent.context), parent, false))
    override fun onBindViewHolder(holder: Holder, position: Int) = holder.bind(orders[position])
    override fun getItemCount() = orders.size

    inner class Holder(private val b: ItemKitchenQueueCardBinding) : RecyclerView.ViewHolder(b.root) {
        fun bind(o: Order) {
            b.tvKitchenOrderId.text = "Order #${o.orderId}"
            b.tvKitchenStatusBadge.text = o.status
            b.tvKitchenCustomer.text = "Customer: ${o.customerName ?: "Walk-In"}"
            b.tvKitchenItemsList.text = o.items.joinToString("\n") { "• ${it.quantity}× ${it.name} ${if (!it.variationName.isNullOrBlank()) "(${it.variationName})" else ""}" }
            b.tvKitchenElapsedTime.text = "Fired: ${o.createdAt ?: "recently"}"

            b.btnKitchenViewTicket.setOnClickListener { onViewTicket(o) }
            b.btnKitchenMarkReady.setOnClickListener { onMarkReady(o) }
        }
    }
}

class DeliveryQueueAdapter(
    private val orders: List<Order>,
    private val onVerifyOtp: (Order) -> Unit,
    private val onCallCustomer: (Order) -> Unit,
    private val onUnassignRider: (Order) -> Unit,
    private val onNavigate: (Order) -> Unit
) : RecyclerView.Adapter<DeliveryQueueAdapter.Holder>() {
    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) = Holder(ItemDeliveryQueueCardBinding.inflate(LayoutInflater.from(parent.context), parent, false))
    override fun onBindViewHolder(holder: Holder, position: Int) = holder.bind(orders[position], position)
    override fun getItemCount() = orders.size

    inner class Holder(private val b: ItemDeliveryQueueCardBinding) : RecyclerView.ViewHolder(b.root) {
        fun bind(o: Order, pos: Int) {
            b.tvDeliveryStopBadge.text = "Stop ${pos + 1}"
            b.tvDeliveryOrderId.text = "Order #${o.orderId}"
            b.tvDeliveryStatusBadge.text = o.status
            b.tvDeliveryCustomer.text = "Customer: ${o.customerName ?: "Customer"} (${o.customerPhone ?: "No phone"})"
            b.tvDeliveryAddress.text = o.address ?: "Delivery order"
            val linesSummary = if (o.items.isNotEmpty()) {
                o.items.joinToString(", ") { "${it.quantity}× ${it.name}" }
            } else {
                "Standard meal order"
            }
            b.tvDeliveryItems.text = linesSummary
            b.tvDeliveryTotalAndPay.text = "${CurrencyFormatter.formatPaise(o.totalPaise)} · ${if (o.paymentMethod == "CASH") "Cash to Collect" else "Paid Online"}"

            b.btnDeliveryCallCustomer.setOnClickListener { onCallCustomer(o) }
            b.btnDeliveryNavigate.setOnClickListener { onNavigate(o) }

            if (o.status == "OUT_FOR_DELIVERY") {
                b.btnDeliveryUnassign.visibility = View.VISIBLE
                b.btnDeliveryUnassign.setOnClickListener { onUnassignRider(o) }
            } else {
                b.btnDeliveryUnassign.visibility = View.GONE
            }

            b.btnQuickVerifyOtp.setOnClickListener { onVerifyOtp(o) }
        }
    }
}

class PastDeliveryAdapter(
    private val orders: List<Order>
) : RecyclerView.Adapter<PastDeliveryAdapter.Holder>() {
    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) = Holder(ItemPastDeliveryCardBinding.inflate(LayoutInflater.from(parent.context), parent, false))
    override fun onBindViewHolder(holder: Holder, position: Int) = holder.bind(orders[position])
    override fun getItemCount() = orders.size

    inner class Holder(private val b: ItemPastDeliveryCardBinding) : RecyclerView.ViewHolder(b.root) {
        fun bind(o: Order) {
            b.tvPastDeliveryDate.text = "DELIVERED · ${o.createdAt ?: "Recently"}"
            b.tvPastDeliveryOrderId.text = "Order #${o.orderId}"
            b.tvPastDeliveryCustomer.text = "Delivered to: ${o.customerName ?: "Customer"} (${o.customerPhone ?: "Phone on record"})"
            b.tvPastDeliveryAddress.text = o.address ?: "Address on record"
            b.tvPastDeliveryItems.text = if (o.items.isNotEmpty()) {
                o.items.joinToString(", ") { "${it.quantity}× ${it.name}" }
            } else {
                "Completed meal order"
            }
            b.tvPastDeliveryTotal.text = CurrencyFormatter.formatPaise(o.totalPaise)
            b.tvPastDeliveryPaymentBadge.text = if (o.paymentMethod == "CASH") "Cash Collected" else "Paid Online"
        }
    }
}

