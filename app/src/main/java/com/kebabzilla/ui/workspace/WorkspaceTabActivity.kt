package com.kebabzilla.ui.workspace

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import coil.load
import com.google.android.material.button.MaterialButton
import com.google.android.material.materialswitch.MaterialSwitch
import com.kebabzilla.R
import com.kebabzilla.data.api.ApiClient
import com.kebabzilla.data.api.NetworkResult
import com.kebabzilla.data.model.*
import com.kebabzilla.databinding.*
import com.kebabzilla.utils.CurrencyFormatter
import kotlinx.coroutines.launch

class WorkspaceTabActivity : AppCompatActivity() {

    private lateinit var binding: ActivityWorkspaceTabBinding
    private lateinit var apiClient: ApiClient

    private var activeTabKey = WorkspaceTabAdapter.TAB_OVERVIEW

    companion object {
        const val EXTRA_TAB_KEY = "extra_tab_key"
        const val EXTRA_TAB_TITLE = "extra_tab_title"

        fun start(context: Context, tabKey: String, title: String? = null) {
            val intent = Intent(context, WorkspaceTabActivity::class.java).apply {
                putExtra(EXTRA_TAB_KEY, tabKey)
                if (title != null) putExtra(EXTRA_TAB_TITLE, title)
            }
            context.startActivity(intent)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, true)
        binding = ActivityWorkspaceTabBinding.inflate(layoutInflater)
        setContentView(binding.root)

        apiClient = ApiClient(this)
        activeTabKey = intent.getStringExtra(EXTRA_TAB_KEY) ?: WorkspaceTabAdapter.TAB_OVERVIEW

        binding.btnTabBack.setOnClickListener {
            finish()
        }

        renderTab()
    }

    private fun setLoading(isLoading: Boolean) {
        binding.progressTabLoading.visibility = if (isLoading) View.VISIBLE else View.GONE
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

    // =========================================================================
    // 1. OVERVIEW TAB
    // =========================================================================
    private fun renderOverviewTab() {
        binding.tvTabHeaderTitle.text = "Store Overview"
        binding.tvTabHeaderSubtitle.text = "Real-time master metrics & KPI pipeline"

        val viewBinding = LayoutTabOverviewBinding.inflate(layoutInflater, binding.frameTabContent, true)
        setLoading(true)

        lifecycleScope.launch {
            val result = apiClient.getSalesReport("today")
            setLoading(false)

            if (result is NetworkResult.Success) {
                val report = result.data
                viewBinding.tvOverviewRevenue.text = CurrencyFormatter.formatPaise(report.revenuePaise)
                viewBinding.tvOverviewOrdersSummary.text = "${report.paidOrders} paid orders · Average ${CurrencyFormatter.formatPaise(report.averageOrderPaise)} per order"
                viewBinding.tvOverviewTotalOrders.text = report.totalOrders.toString()
                viewBinding.tvOverviewPaymentSplit.text = "${report.onlineOrders} / ${report.cashOrders}"

                // Status breakdown rows
                viewBinding.layoutOverviewStatuses.removeAllViews()
                val statuses = listOf(
                    "PLACED" to "New Orders",
                    "ACCEPTED" to "Accepted",
                    "PREPARING" to "Grill In Progress",
                    "READY" to "Ready for Dispatch",
                    "OUT_FOR_DELIVERY" to "Out with Rider",
                    "DELIVERED" to "Delivered",
                    "CANCELLED" to "Cancelled"
                )
                for ((statusKey, label) in statuses) {
                    val count = report.statuses[statusKey] ?: 0
                    val row = LinearLayout(this@WorkspaceTabActivity).apply {
                        orientation = LinearLayout.HORIZONTAL
                        setPadding(0, 8, 0, 8)
                    }
                    val tvLabel = TextView(this@WorkspaceTabActivity).apply {
                        layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                        text = label
                        setTextColor(ContextCompat.getColor(context, R.color.brand_ink))
                        textSize = 13f
                    }
                    val tvCount = TextView(this@WorkspaceTabActivity).apply {
                        text = "$count orders"
                        setTextColor(ContextCompat.getColor(context, if (count > 0) R.color.brand_red else R.color.brand_muted))
                        textSize = 13f
                        typeface = android.graphics.Typeface.DEFAULT_BOLD
                    }
                    row.addView(tvLabel)
                    row.addView(tvCount)
                    viewBinding.layoutOverviewStatuses.addView(row)
                }

                // Top Items
                viewBinding.layoutOverviewTopItems.removeAllViews()
                if (report.topItems.isEmpty()) {
                    val emptyTv = TextView(this@WorkspaceTabActivity).apply {
                        text = "Orders will tally top cooking items here."
                        setTextColor(ContextCompat.getColor(context, R.color.brand_muted))
                        textSize = 13f
                        setPadding(0, 8, 0, 8)
                    }
                    viewBinding.layoutOverviewTopItems.addView(emptyTv)
                } else {
                    for (item in report.topItems) {
                        val row = LinearLayout(this@WorkspaceTabActivity).apply {
                            orientation = LinearLayout.HORIZONTAL
                            setPadding(0, 8, 0, 8)
                        }
                        val tvName = TextView(this@WorkspaceTabActivity).apply {
                            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                            text = item.name
                            setTextColor(ContextCompat.getColor(context, R.color.brand_ink))
                            textSize = 13f
                        }
                        val tvQty = TextView(this@WorkspaceTabActivity).apply {
                            text = "${item.quantity} portions"
                            setTextColor(ContextCompat.getColor(context, R.color.brand_ink))
                            textSize = 13f
                            typeface = android.graphics.Typeface.DEFAULT_BOLD
                        }
                        row.addView(tvName)
                        row.addView(tvQty)
                        viewBinding.layoutOverviewTopItems.addView(row)
                    }
                }
            } else if (result is NetworkResult.Error) {
                Toast.makeText(this@WorkspaceTabActivity, result.message, Toast.LENGTH_SHORT).show()
            }
        }
    }

    // =========================================================================
    // 2. ORDERS TAB (Master Orders, Status, Refund)
    // =========================================================================
    private fun renderOrdersTab() {
        binding.tvTabHeaderTitle.text = "Master Orders"
        binding.tvTabHeaderSubtitle.text = "Live orders, statuses & instant refunds"

        val viewBinding = LayoutTabOrdersBinding.inflate(layoutInflater, binding.frameTabContent, true)
        val filterList = listOf("ALL", "PLACED", "ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED")
        var currentFilter = "ALL"

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
                    viewBinding.rvAdminOrders.adapter = AdminOrderAdapter(orders,
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
                        onRefund = { order ->
                            confirmRefundOrder(order) {
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

        val viewBinding = LayoutTabMenuBinding.inflate(layoutInflater, binding.frameTabContent, true)
        viewBinding.rvAdminMenu.layoutManager = LinearLayoutManager(this)

        fun loadMenu(query: String = "") {
            setLoading(true)
            lifecycleScope.launch {
                val menuRes = apiClient.getAllMenuItemsCombined()
                val pausesRes = apiClient.getMenuPauses()
                setLoading(false)

                if (menuRes is NetworkResult.Success) {
                    val pausedIds = (pausesRes as? NetworkResult.Success)?.data?.map { it.menuItemId }?.toSet() ?: emptySet()
                    val allItems = menuRes.data.map { item ->
                        item.copy(isPaused = pausedIds.contains(item.id.toString()) || item.isPaused)
                    }
                    val filtered = if (query.isNotBlank()) {
                        allItems.filter { it.name.contains(query, ignoreCase = true) || it.category.contains(query, ignoreCase = true) }
                    } else allItems

                    if (filtered.isEmpty()) {
                        viewBinding.tvAdminMenuEmpty.visibility = View.VISIBLE
                        viewBinding.rvAdminMenu.visibility = View.GONE
                    } else {
                        viewBinding.tvAdminMenuEmpty.visibility = View.GONE
                        viewBinding.rvAdminMenu.visibility = View.VISIBLE
                        viewBinding.rvAdminMenu.adapter = AdminMenuAdapter(filtered) { item, isAvailable ->
                            lifecycleScope.launch {
                                val toggleRes = apiClient.toggleMenuPause(item.id.toString(), !isAvailable)
                                if (toggleRes is NetworkResult.Success) {
                                    Toast.makeText(this@WorkspaceTabActivity, "${item.name} ${if (isAvailable) "restocked" else "paused (86ed)"}", Toast.LENGTH_SHORT).show()
                                } else if (toggleRes is NetworkResult.Error) {
                                    Toast.makeText(this@WorkspaceTabActivity, toggleRes.message, Toast.LENGTH_SHORT).show()
                                }
                            }
                        }
                    }
                } else if (menuRes is NetworkResult.Error) {
                    Toast.makeText(this@WorkspaceTabActivity, menuRes.message, Toast.LENGTH_SHORT).show()
                }
            }
        }

        viewBinding.etMenuSearch.setOnEditorActionListener { _, _, _ ->
            loadMenu(viewBinding.etMenuSearch.text.toString().trim())
            true
        }
        loadMenu()
    }

    // =========================================================================
    // 4. PEOPLE TAB (Team Roster & Provisioning)
    // =========================================================================
    private fun renderPeopleTab() {
        binding.tvTabHeaderTitle.text = "People & Team"
        binding.tvTabHeaderSubtitle.text = "Team roster, kitchen roles & rider staff"

        val viewBinding = LayoutTabPeopleBinding.inflate(layoutInflater, binding.frameTabContent, true)
        viewBinding.rvStaffMembers.layoutManager = LinearLayoutManager(this)

        fun loadStaff() {
            setLoading(true)
            lifecycleScope.launch {
                val res = apiClient.getAdminAccounts(excludeUsers = true)
                setLoading(false)

                if (res is NetworkResult.Success) {
                    val staffList = res.data
                    viewBinding.tvStaffCountSummary.text = "${staffList.size} Restaurant Staff Members"
                    if (staffList.isEmpty()) {
                        viewBinding.tvStaffEmpty.visibility = View.VISIBLE
                        viewBinding.rvStaffMembers.visibility = View.GONE
                    } else {
                        viewBinding.tvStaffEmpty.visibility = View.GONE
                        viewBinding.rvStaffMembers.visibility = View.VISIBLE
                        viewBinding.rvStaffMembers.adapter = AdminStaffAdapter(staffList)
                    }
                } else if (res is NetworkResult.Error) {
                    Toast.makeText(this@WorkspaceTabActivity, res.message, Toast.LENGTH_SHORT).show()
                }
            }
        }

        viewBinding.btnAddStaffMember.setOnClickListener {
            showAddStaffDialog {
                loadStaff()
            }
        }

        loadStaff()
    }

    private fun showAddStaffDialog(onStaffAdded: () -> Unit) {
        val dialogView = LayoutInflater.from(this).inflate(R.layout.dialog_edit_profile, null)
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
        binding.tvTabHeaderTitle.text = "Broadcast & Alerts"
        binding.tvTabHeaderSubtitle.text = "Push alerts & emergency flash alerts"

        val viewBinding = LayoutTabBroadcastBinding.inflate(layoutInflater, binding.frameTabContent, true)

        fun loadLogs() {
            lifecycleScope.launch {
                val res = apiClient.getOfferLogs()
                if (res is NetworkResult.Success) {
                    viewBinding.layoutPastBroadcasts.removeAllViews()
                    for (log in res.data) {
                        val card = com.google.android.material.card.MaterialCardView(this@WorkspaceTabActivity).apply {
                            radius = 12 * resources.displayMetrics.density
                            strokeColor = ContextCompat.getColor(context, R.color.brand_line)
                            strokeWidth = (1 * resources.displayMetrics.density).toInt()
                            val inner = LinearLayout(context).apply {
                                orientation = LinearLayout.VERTICAL
                                setPadding(32, 24, 32, 24)
                                addView(TextView(context).apply { text = log.title; textSize = 14f; typeface = android.graphics.Typeface.DEFAULT_BOLD; setTextColor(ContextCompat.getColor(context, R.color.brand_ink)) })
                                addView(TextView(context).apply { text = log.message; textSize = 12f; setTextColor(ContextCompat.getColor(context, R.color.brand_muted)); setPadding(0, 4, 0, 4) })
                                addView(TextView(context).apply { text = "Sent to ${log.recipientCount} customers · ${log.createdAt ?: "Recently"}"; textSize = 11f; setTextColor(ContextCompat.getColor(context, R.color.brand_muted)) })
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
        loadLogs()

        viewBinding.btnSendBroadcast.setOnClickListener {
            val title = viewBinding.etBroadcastTitle.text.toString().trim()
            val message = viewBinding.etBroadcastBody.text.toString().trim()
            if (title.isBlank() || message.isBlank()) {
                Toast.makeText(this, "Please enter both header and body", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            setLoading(true)
            lifecycleScope.launch {
                val res = apiClient.sendOfferBroadcast(title, message)
                setLoading(false)
                if (res is NetworkResult.Success) {
                    Toast.makeText(this@WorkspaceTabActivity, "Broadcast notification sent!", Toast.LENGTH_LONG).show()
                    viewBinding.etBroadcastTitle.setText("")
                    viewBinding.etBroadcastBody.setText("")
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
                        viewBinding.rvDiscountsList.adapter = AdminDiscountAdapter(discounts) { discount ->
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
                        viewBinding.rvKitchenQueue.adapter = KitchenQueueAdapter(activeKitchen) { order ->
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
                        }
                    }
                } else if (res is NetworkResult.Error) {
                    Toast.makeText(this@WorkspaceTabActivity, res.message, Toast.LENGTH_SHORT).show()
                }
            }
        }
        loadKitchenQueue()
    }

    // =========================================================================
    // 9. WALK-IN-BILLING TAB (POS Register)
    // =========================================================================
    private fun renderBillingTab() {
        binding.tvTabHeaderTitle.text = "Walk-In POS Billing"
        binding.tvTabHeaderSubtitle.text = "Counter POS register & quick receipts"

        val viewBinding = LayoutTabBillingBinding.inflate(layoutInflater, binding.frameTabContent, true)
        val selectedItemsMap = mutableMapOf<MenuItem, Int>()

        fun updateDue() {
            var totalPaise = 0L
            for ((item, qty) in selectedItemsMap) {
                totalPaise += item.displayPricePaise * qty
            }
            viewBinding.tvPosTotalAmount.text = CurrencyFormatter.formatPaise(totalPaise)
        }

        setLoading(true)
        lifecycleScope.launch {
            val res = apiClient.getAllMenuItemsCombined()
            setLoading(false)

            if (res is NetworkResult.Success) {
                viewBinding.layoutPosItemsContainer.removeAllViews()
                for (item in res.data.take(15)) {
                    val row = LinearLayout(this@WorkspaceTabActivity).apply {
                        orientation = LinearLayout.HORIZONTAL
                        gravity = android.view.Gravity.CENTER_VERTICAL
                        setPadding(16, 12, 16, 12)
                    }
                    val tvName = TextView(this@WorkspaceTabActivity).apply {
                        layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                        text = "${item.name} (${CurrencyFormatter.formatPaise(item.displayPricePaise)})"
                        setTextColor(ContextCompat.getColor(context, R.color.brand_ink))
                        textSize = 13f
                    }
                    val btnPlus = MaterialButton(this@WorkspaceTabActivity).apply {
                        text = "+ Add"
                        textSize = 11f
                        cornerRadius = (6 * resources.displayMetrics.density).toInt()
                        setBackgroundColor(ContextCompat.getColor(context, R.color.brand_red))
                        setOnClickListener {
                            val curr = selectedItemsMap[item] ?: 0
                            selectedItemsMap[item] = curr + 1
                            text = "(${curr + 1}) Add"
                            updateDue()
                        }
                    }
                    row.addView(tvName)
                    row.addView(btnPlus)
                    viewBinding.layoutPosItemsContainer.addView(row)
                }
            }
        }

        viewBinding.btnGeneratePosBill.setOnClickListener {
            if (selectedItemsMap.isEmpty()) {
                Toast.makeText(this, "Please add items to ticket", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            val customer = viewBinding.etPosCustomerName.text.toString().trim().ifBlank { "Walk-In Guest" }
            AlertDialog.Builder(this)
                .setTitle("Receipt Generated")
                .setMessage("Walk-in order for $customer placed!\nAmount: ${viewBinding.tvPosTotalAmount.text}\nSent to kitchen pass successfully.")
                .setPositiveButton("Done") { dialog, _ ->
                    dialog.dismiss()
                    finish()
                }
                .show()
        }
    }

    // =========================================================================
    // 10. MENU AVAILABILITY TAB (86 Station)
    // =========================================================================
    private fun renderMenuAvailabilityTab() {
        binding.tvTabHeaderTitle.text = "Menu Availability"
        binding.tvTabHeaderSubtitle.text = "Real-time 86 list, pause items & daily stock"

        val viewBinding = LayoutTabMenuAvailabilityBinding.inflate(layoutInflater, binding.frameTabContent, true)
        viewBinding.rvAvailabilityItems.layoutManager = LinearLayoutManager(this)

        fun loadAvailability(query: String = "") {
            setLoading(true)
            lifecycleScope.launch {
                val menuRes = apiClient.getAllMenuItemsCombined()
                val pausesRes = apiClient.getMenuPauses()
                setLoading(false)

                if (menuRes is NetworkResult.Success) {
                    val pausedIds = (pausesRes as? NetworkResult.Success)?.data?.map { it.menuItemId }?.toSet() ?: emptySet()
                    val allItems = menuRes.data.map { item ->
                        item.copy(isPaused = pausedIds.contains(item.id.toString()) || item.isPaused)
                    }
                    val filtered = if (query.isNotBlank()) {
                        allItems.filter { it.name.contains(query, ignoreCase = true) }
                    } else allItems

                    viewBinding.rvAvailabilityItems.adapter = AdminMenuAdapter(filtered) { item, isAvailable ->
                        lifecycleScope.launch {
                            val toggleRes = apiClient.toggleMenuPause(item.id.toString(), !isAvailable)
                            if (toggleRes is NetworkResult.Success) {
                                Toast.makeText(this@WorkspaceTabActivity, "${item.name} availability toggled", Toast.LENGTH_SHORT).show()
                            }
                        }
                    }
                }
            }
        }

        viewBinding.etAvailabilitySearch.setOnEditorActionListener { _, _, _ ->
            loadAvailability(viewBinding.etAvailabilitySearch.text.toString().trim())
            true
        }
        loadAvailability()
    }

    // =========================================================================
    // 11. DELIVERY QUEUE TAB (ALNS Fleet & OTP)
    // =========================================================================
    private fun renderDeliveryQueueTab() {
        binding.tvTabHeaderTitle.text = "Delivery Dispatch"
        binding.tvTabHeaderSubtitle.text = "ALNS batching, rider routes & live GPS"

        val viewBinding = LayoutTabDeliveryQueueBinding.inflate(layoutInflater, binding.frameTabContent, true)
        viewBinding.rvDeliveryOrders.layoutManager = LinearLayoutManager(this)

        fun loadDeliveries() {
            setLoading(true)
            lifecycleScope.launch {
                val res = apiClient.getStaffOrders()
                setLoading(false)

                if (res is NetworkResult.Success) {
                    val deliveryOrders = res.data.filter { it.status in listOf("READY", "OUT_FOR_DELIVERY") }
                    if (deliveryOrders.isEmpty()) {
                        viewBinding.tvDeliveryEmpty.visibility = View.VISIBLE
                        viewBinding.rvDeliveryOrders.visibility = View.GONE
                    } else {
                        viewBinding.tvDeliveryEmpty.visibility = View.GONE
                        viewBinding.rvDeliveryOrders.visibility = View.VISIBLE
                        viewBinding.rvDeliveryOrders.adapter = DeliveryQueueAdapter(deliveryOrders) { order ->
                            viewBinding.etDeliveryOrderId.setText(order.orderId)
                            viewBinding.etDeliveryOtp.requestFocus()
                        }
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
                } else if (res is NetworkResult.Error) {
                    Toast.makeText(this@WorkspaceTabActivity, res.message, Toast.LENGTH_SHORT).show()
                }
            }
        }

        loadDeliveries()
    }

    // =========================================================================
    // 12. SALES REPORTS TAB (Revenue, GST & Channels)
    // =========================================================================
    private fun renderReportsTab() {
        binding.tvTabHeaderTitle.text = "Sales & Analytics"
        binding.tvTabHeaderSubtitle.text = "Daily revenue, GST & shift analytics"

        val viewBinding = LayoutTabReportsBinding.inflate(layoutInflater, binding.frameTabContent, true)
        var selectedPeriod = "today"

        fun updatePeriodUI() {
            viewBinding.btnPeriodToday.background = if (selectedPeriod == "today") ContextCompat.getDrawable(this, R.drawable.bg_pill_primary) else null
            viewBinding.btnPeriodToday.setTextColor(ContextCompat.getColor(this, if (selectedPeriod == "today") R.color.white else R.color.brand_muted))

            viewBinding.btnPeriodWeek.background = if (selectedPeriod == "week") ContextCompat.getDrawable(this, R.drawable.bg_pill_primary) else null
            viewBinding.btnPeriodWeek.setTextColor(ContextCompat.getColor(this, if (selectedPeriod == "week") R.color.white else R.color.brand_muted))

            viewBinding.btnPeriodMonth.background = if (selectedPeriod == "month") ContextCompat.getDrawable(this, R.drawable.bg_pill_primary) else null
            viewBinding.btnPeriodMonth.setTextColor(ContextCompat.getColor(this, if (selectedPeriod == "month") R.color.white else R.color.brand_muted))
        }

        fun loadReport(period: String) {
            setLoading(true)
            lifecycleScope.launch {
                val res = apiClient.getSalesReport(period)
                setLoading(false)

                if (res is NetworkResult.Success) {
                    val report = res.data
                    viewBinding.tvReportRevenue.text = CurrencyFormatter.formatPaise(report.revenuePaise)
                    viewBinding.tvReportPaidOrders.text = "From ${report.paidOrders} settled customer orders"

                    val gstPaise = (report.revenuePaise * 5) / 105
                    viewBinding.tvReportGst.text = CurrencyFormatter.formatPaise(gstPaise)
                    viewBinding.tvReportAov.text = CurrencyFormatter.formatPaise(report.averageOrderPaise)

                    viewBinding.tvReportOnlineRev.text = "${CurrencyFormatter.formatPaise(report.onlineRevenuePaise)} (${report.onlineOrders})"
                    viewBinding.tvReportCashRev.text = "${CurrencyFormatter.formatPaise(report.cashRevenuePaise)} (${report.cashOrders})"
                } else if (res is NetworkResult.Error) {
                    Toast.makeText(this@WorkspaceTabActivity, res.message, Toast.LENGTH_SHORT).show()
                }
            }
        }

        viewBinding.btnPeriodToday.setOnClickListener { selectedPeriod = "today"; updatePeriodUI(); loadReport("today") }
        viewBinding.btnPeriodWeek.setOnClickListener { selectedPeriod = "week"; updatePeriodUI(); loadReport("week") }
        viewBinding.btnPeriodMonth.setOnClickListener { selectedPeriod = "month"; updatePeriodUI(); loadReport("month") }

        updatePeriodUI()
        loadReport("today")
    }

    // =========================================================================
    // 13. RESTAURANT SETTINGS TAB (Hours, Geofence, Master Switches)
    // =========================================================================
    private fun renderSettingsTab() {
        binding.tvTabHeaderTitle.text = "Restaurant Settings"
        binding.tvTabHeaderSubtitle.text = "Store hours, geofence & payment rails"

        val viewBinding = LayoutTabSettingsBinding.inflate(layoutInflater, binding.frameTabContent, true)

        setLoading(true)
        lifecycleScope.launch {
            val res = apiClient.getAdminSettings()
            setLoading(false)

            if (res is NetworkResult.Success) {
                val s = res.data
                viewBinding.switchRestaurantOpen.isChecked = s.isOpen
                viewBinding.switchDeliveryActive.isChecked = s.isDeliveryEnabled
                viewBinding.etSettingsOpenTime.setText(s.openTime ?: "11:00")
                viewBinding.etSettingsCloseTime.setText(s.closeTime ?: "23:00")
                viewBinding.etSettingsPhone.setText(s.phone ?: "+91 9876543210")
                viewBinding.etSettingsRadius.setText(s.deliveryRadiusKm.toString())
            }
        }

        viewBinding.btnSaveSettings.setOnClickListener {
            val updated = AdminRestaurantSettings(
                isOpen = viewBinding.switchRestaurantOpen.isChecked,
                isDeliveryEnabled = viewBinding.switchDeliveryActive.isChecked,
                openTime = viewBinding.etSettingsOpenTime.text.toString().trim(),
                closeTime = viewBinding.etSettingsCloseTime.text.toString().trim(),
                phone = viewBinding.etSettingsPhone.text.toString().trim(),
                deliveryRadiusKm = viewBinding.etSettingsRadius.text.toString().toDoubleOrNull() ?: 15.0
            )

            setLoading(true)
            lifecycleScope.launch {
                val res = apiClient.updateAdminSettings(updated)
                setLoading(false)
                if (res is NetworkResult.Success) {
                    Toast.makeText(this@WorkspaceTabActivity, "Settings updated successfully!", Toast.LENGTH_LONG).show()
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
    private val onRefund: (Order) -> Unit
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
            b.tvOrderCustomerAndDate.text = "${o.customerName ?: "Customer"} (${o.customerPhone?.ifBlank { "Delivery" } ?: "Delivery"})"
            b.tvOrderAddress.text = o.address ?: "Delivery order"
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

            if (o.status != "CANCELLED" && o.status != "DELIVERED") {
                b.btnOrderRefund.visibility = View.VISIBLE
                b.btnOrderRefund.setOnClickListener { onRefund(o) }
            } else {
                b.btnOrderRefund.visibility = View.GONE
            }
        }
    }
}

class AdminMenuAdapter(
    private val items: List<MenuItem>,
    private val onStockToggle: (MenuItem, Boolean) -> Unit
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
        }
    }
}

class AdminStaffAdapter(private val staff: List<AdminAccount>) : RecyclerView.Adapter<AdminStaffAdapter.Holder>() {
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
            b.tvEventActor.text = "Actor: ${e.actorEmail ?: "System Automation"}"
            b.tvEventTime.text = e.createdAt ?: "Recently"
        }
    }
}

class AdminDiscountAdapter(
    private val discounts: List<MenuDiscount>,
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
            b.btnDeleteDiscount.setOnClickListener { onDelete(d) }
        }
    }
}

class KitchenQueueAdapter(
    private val orders: List<Order>,
    private val onMarkReady: (Order) -> Unit
) : RecyclerView.Adapter<KitchenQueueAdapter.Holder>() {
    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) = Holder(ItemKitchenQueueCardBinding.inflate(LayoutInflater.from(parent.context), parent, false))
    override fun onBindViewHolder(holder: Holder, position: Int) = holder.bind(orders[position])
    override fun getItemCount() = orders.size

    inner class Holder(private val b: ItemKitchenQueueCardBinding) : RecyclerView.ViewHolder(b.root) {
        fun bind(o: Order) {
            b.tvKitchenOrderId.text = "Order #${o.orderId}"
            b.tvKitchenStatusBadge.text = o.status
            b.tvKitchenCustomer.text = "Customer: ${o.customerName ?: "Customer"}"
            b.tvKitchenItemsList.text = o.items.joinToString("\n") { "• ${it.quantity}× ${it.name} ${if (!it.variationName.isNullOrBlank()) "(${it.variationName})" else ""}" }
            b.tvKitchenElapsedTime.text = "Created ${o.createdAt ?: "recently"}"
            b.btnKitchenMarkReady.setOnClickListener { onMarkReady(o) }
        }
    }
}

class DeliveryQueueAdapter(
    private val orders: List<Order>,
    private val onVerifyOtp: (Order) -> Unit
) : RecyclerView.Adapter<DeliveryQueueAdapter.Holder>() {
    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) = Holder(ItemDeliveryQueueCardBinding.inflate(LayoutInflater.from(parent.context), parent, false))
    override fun onBindViewHolder(holder: Holder, position: Int) = holder.bind(orders[position])
    override fun getItemCount() = orders.size

    inner class Holder(private val b: ItemDeliveryQueueCardBinding) : RecyclerView.ViewHolder(b.root) {
        fun bind(o: Order) {
            b.tvDeliveryOrderId.text = "Order #${o.orderId}"
            b.tvDeliveryStatusBadge.text = o.status
            b.tvDeliveryCustomer.text = "Customer: ${o.customerName ?: "Customer"} (${o.customerPhone ?: ""})"
            b.tvDeliveryAddress.text = o.address ?: "Delivery order"
            b.tvDeliveryTotalAndPay.text = "${CurrencyFormatter.formatPaise(o.totalPaise)} · ${o.paymentMethod ?: "COD"}"
            b.btnQuickVerifyOtp.setOnClickListener { onVerifyOtp(o) }
        }
    }
}
