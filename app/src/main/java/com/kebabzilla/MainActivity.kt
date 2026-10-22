package com.kebabzilla

import android.content.Context
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.fragment.app.Fragment
import com.kebabzilla.data.local.CartManager
import com.kebabzilla.data.local.TokenManager
import com.kebabzilla.databinding.ActivityMainBinding
import com.kebabzilla.ui.cart.CartFragment
import com.kebabzilla.ui.menu.StorefrontFragment
import com.kebabzilla.ui.orders.OrdersFragment
import com.kebabzilla.ui.profile.ProfileFragment
import com.kebabzilla.ui.workspace.WorkspaceFragment
import com.kebabzilla.utils.Constants
import com.kebabzilla.utils.CurrencyFormatter

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var tokenManager: TokenManager

    private val storefrontFragment = StorefrontFragment()
    private val workspaceFragment = WorkspaceFragment()
    private val cartFragment = CartFragment()
    private val ordersFragment = OrdersFragment()
    private val profileFragment = ProfileFragment()

    private var activeFragment: Fragment = storefrontFragment
    private var isLandingWorkspace = false

    companion object {
        private const val PREF_LANDING_PAGE = "pref_active_landing_page"
        private const val LANDING_STOREFRONT = "STOREFRONT"
        private const val LANDING_WORKSPACE = "WORKSPACE"
    }

    private val cartListener = {
        updateFloatingCartBar()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        tokenManager = TokenManager(this)

        val role = tokenManager.getUserRole().uppercase()
        val isPrivileged = role in listOf("STAFF", "EMPLOYEE", "RIDER", "DELIVERY", "ADMIN")
        val prefs = getSharedPreferences(Constants.PREFS_NAME, Context.MODE_PRIVATE)
        val savedLanding = prefs.getString(PREF_LANDING_PAGE, LANDING_STOREFRONT)
        isLandingWorkspace = isPrivileged && (savedLanding == LANDING_WORKSPACE)

        setupWindowInsets()
        setupNavigation(savedInstanceState)
        setupFloatingCart()
        setupBackPressHandling()
        CartManager.addListener(cartListener)
    }

    override fun onDestroy() {
        super.onDestroy()
        CartManager.removeListener(cartListener)
    }

    private var statusBarTop = 0
    private var navBarBottom = 0

    private fun setupWindowInsets() {
        ViewCompat.setOnApplyWindowInsetsListener(binding.root) { _, windowInsets ->
            val statusBarInset = windowInsets.getInsets(WindowInsetsCompat.Type.statusBars())
            val navBarInset = windowInsets.getInsets(WindowInsetsCompat.Type.navigationBars())

            statusBarTop = statusBarInset.top
            navBarBottom = navBarInset.bottom

            updateFragmentContainerPadding()

            // Floating cart dock sits above the global navigation buttons / gesture pill
            val cartMarginBottom = (16 * resources.displayMetrics.density).toInt()
            val params = binding.cardFloatingCart.layoutParams as ViewGroup.MarginLayoutParams
            params.bottomMargin = navBarInset.bottom + cartMarginBottom
            binding.cardFloatingCart.layoutParams = params

            windowInsets
        }
    }

    private fun updateFragmentContainerPadding() {
        // StorefrontFragment extends to top = 0 to bleed directly into notification panel for immersion
        val topPadding = if (activeFragment == storefrontFragment) 0 else statusBarTop
        binding.fragmentContainer.setPadding(0, topPadding, 0, navBarBottom)
    }

    private fun setupNavigation(savedInstanceState: Bundle?) {
        if (savedInstanceState == null) {
            val initialFragment = if (isLandingWorkspace) workspaceFragment else storefrontFragment
            val tag = if (isLandingWorkspace) "workspace" else "storefront"
            supportFragmentManager.beginTransaction()
                .add(R.id.fragment_container, initialFragment, tag)
                .commit()
            activeFragment = initialFragment
        }
    }

    private fun setupBackPressHandling() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val homeFragment = if (isLandingWorkspace) workspaceFragment else storefrontFragment
                if (activeFragment != homeFragment) {
                    if (isLandingWorkspace) showWorkspace() else showStorefront()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })
    }

    fun isWorkspaceActive(): Boolean = isLandingWorkspace

    fun showWorkspace() {
        isLandingWorkspace = true
        saveLandingPreference(LANDING_WORKSPACE)
        switchFragment(workspaceFragment)
    }

    fun showStorefront() {
        isLandingWorkspace = false
        saveLandingPreference(LANDING_STOREFRONT)
        switchFragment(storefrontFragment)
    }

    private fun saveLandingPreference(pref: String) {
        val prefs = getSharedPreferences(Constants.PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(PREF_LANDING_PAGE, pref).apply()
    }

    fun showCart() {
        switchFragment(cartFragment)
    }

    fun showOrders() {
        switchFragment(ordersFragment)
    }

    fun showProfile() {
        switchFragment(profileFragment)
    }

    fun selectTab(tabId: Int) {
        when (tabId) {
            R.id.nav_storefront -> {
                if (isLandingWorkspace) showWorkspace() else showStorefront()
            }
            R.id.nav_cart -> showCart()
            R.id.nav_orders -> showOrders()
            R.id.nav_profile -> showProfile()
            else -> showStorefront()
        }
    }

    private fun switchFragment(target: Fragment) {
        if (activeFragment != target) {
            val transaction = supportFragmentManager.beginTransaction()
            if (!target.isAdded) {
                transaction.hide(activeFragment).add(R.id.fragment_container, target).commit()
            } else {
                transaction.hide(activeFragment).show(target).commit()
            }
            activeFragment = target
            updateFragmentContainerPadding()
            updateFloatingCartBar()
        }
    }

    private fun setupFloatingCart() {
        binding.cardFloatingCart.setOnClickListener {
            showCart()
        }
        updateFloatingCartBar()
    }

    private fun updateFloatingCartBar() {
        val count = CartManager.getTotalItemCount()
        val total = CartManager.getSubtotalPaise()

        // Only show floating cart on Storefront tab when there are items
        if (activeFragment == storefrontFragment && count > 0) {
            binding.cardFloatingCart.visibility = View.VISIBLE
            binding.tvFloatingCartTotal.text = "$count items · ${CurrencyFormatter.formatPaise(total)}"
            binding.tvFloatingCartBadge.text = count.toString()
            binding.tvFloatingCartCount.text = if (total >= 49900) "Free delivery unlocked" else "Add items for free delivery"
        } else {
            binding.cardFloatingCart.visibility = View.GONE
        }
    }
}
