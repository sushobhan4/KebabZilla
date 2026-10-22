package com.kebabzilla.ui.profile

import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.kebabzilla.MainActivity
import com.kebabzilla.R
import com.kebabzilla.data.api.ApiClient
import com.kebabzilla.data.api.NetworkResult
import com.kebabzilla.data.local.TokenManager
import com.kebabzilla.data.model.User
import com.kebabzilla.databinding.FragmentProfileBinding
import com.kebabzilla.ui.address.SavedAddressesActivity
import com.kebabzilla.ui.auth.AuthActivity
import com.kebabzilla.utils.ThemeManager
import kotlinx.coroutines.launch

class ProfileFragment : Fragment() {

    private var _binding: FragmentProfileBinding? = null
    private val binding get() = _binding!!

    private lateinit var apiClient: ApiClient
    private lateinit var tokenManager: TokenManager
    private var currentUser: User? = null
    private var isThemeOptionsExpanded = false

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentProfileBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        apiClient = ApiClient(requireContext())
        tokenManager = TokenManager(requireContext())

        setupListeners()
        setupThemeSelector()
    }

    override fun onResume() {
        super.onResume()
        renderProfile()
        setupThemeSelector()
        updateRoleActions()
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }

    private fun setupListeners() {
        binding.btnProfileBack.setOnClickListener {
            val mainAct = activity as? MainActivity
            if (mainAct?.isWorkspaceActive() == true) {
                mainAct.showWorkspace()
            } else {
                mainAct?.showStorefront()
            }
        }

        binding.btnProfileGuestSignIn.setOnClickListener {
            startActivity(Intent(requireContext(), AuthActivity::class.java))
        }

        binding.cardNavTrackOrders.setOnClickListener {
            (activity as? MainActivity)?.selectTab(R.id.nav_orders)
        }

        binding.cardNavSavedAddresses.setOnClickListener {
            if (!tokenManager.isLoggedIn()) {
                Toast.makeText(requireContext(), "Please sign in to view saved addresses", Toast.LENGTH_SHORT).show()
                startActivity(Intent(requireContext(), AuthActivity::class.java))
                return@setOnClickListener
            }
            startActivity(Intent(requireContext(), SavedAddressesActivity::class.java))
        }

        binding.btnEditProfile.setOnClickListener {
            if (!tokenManager.isLoggedIn()) {
                Toast.makeText(requireContext(), "Please sign in to edit your profile", Toast.LENGTH_SHORT).show()
                startActivity(Intent(requireContext(), AuthActivity::class.java))
                return@setOnClickListener
            }
            startActivity(Intent(requireContext(), EditProfileActivity::class.java))
        }

        binding.btnSignOut.setOnClickListener {
            AlertDialog.Builder(requireContext())
                .setTitle("Sign Out")
                .setMessage("Are you sure you want to sign out of your KebabZilla account?")
                .setPositiveButton("Sign Out") { dialog, _ ->
                    tokenManager.clearSession()
                    dialog.dismiss()
                    Toast.makeText(requireContext(), "You have been signed out", Toast.LENGTH_SHORT).show()
                    renderProfile()
                }
                .setNegativeButton("Cancel", null)
                .show()
        }

        // Security Button (visible for staff/delivery/admin)
        binding.cardNavSecurity.setOnClickListener {
            startActivity(Intent(requireContext(), SecurityActivity::class.java))
        }

        // Workspace / Storefront Switcher Button
        binding.cardNavWorkspaceOrStorefront.setOnClickListener {
            val mainAct = activity as? MainActivity
            if (mainAct?.isWorkspaceActive() == true) {
                mainAct.showStorefront()
            } else {
                mainAct?.showWorkspace()
            }
        }
    }

    private fun setupThemeSelector() {
        val currentMode = ThemeManager.getThemeMode(requireContext())
        updateThemeUI(currentMode)

        binding.layoutThemeHeader.setOnClickListener {
            isThemeOptionsExpanded = !isThemeOptionsExpanded
            binding.layoutThemeOptions.visibility = if (isThemeOptionsExpanded) View.VISIBLE else View.GONE
            binding.ivThemeChevron.animate()
                .rotation(if (isThemeOptionsExpanded) 180f else 0f)
                .setDuration(200)
                .start()
        }

        binding.btnThemeOptionLight.setOnClickListener {
            ThemeManager.setThemeMode(requireContext(), ThemeManager.MODE_LIGHT)
            updateThemeUI(ThemeManager.MODE_LIGHT)
        }

        binding.btnThemeOptionDark.setOnClickListener {
            ThemeManager.setThemeMode(requireContext(), ThemeManager.MODE_DARK)
            updateThemeUI(ThemeManager.MODE_DARK)
        }

        binding.btnThemeOptionSystem.setOnClickListener {
            ThemeManager.setThemeMode(requireContext(), ThemeManager.MODE_SYSTEM)
            updateThemeUI(ThemeManager.MODE_SYSTEM)
        }
    }

    private fun updateThemeUI(mode: String) {
        binding.ivCheckThemeLight.visibility = if (mode == ThemeManager.MODE_LIGHT) View.VISIBLE else View.INVISIBLE
        binding.ivCheckThemeDark.visibility = if (mode == ThemeManager.MODE_DARK) View.VISIBLE else View.INVISIBLE
        binding.ivCheckThemeSystem.visibility = if (mode == ThemeManager.MODE_SYSTEM) View.VISIBLE else View.INVISIBLE

        binding.tvThemeCurrentMode.text = when (mode) {
            ThemeManager.MODE_LIGHT -> "Light mode"
            ThemeManager.MODE_DARK -> "Dark mode"
            else -> "System default"
        }
    }

    private fun updateRoleActions() {
        val role = tokenManager.getUserRole().uppercase()
        val isPrivileged = role in listOf("STAFF", "EMPLOYEE", "RIDER", "DELIVERY", "ADMIN")

        if (isPrivileged) {
            binding.cardNavWorkspaceOrStorefront.visibility = View.VISIBLE
            binding.cardNavSecurity.visibility = View.VISIBLE

            val mainAct = activity as? MainActivity
            val isWorkspaceActive = mainAct?.isWorkspaceActive() == true

            if (isWorkspaceActive) {
                // If in Workspace -> option to switch to Storefront
                binding.tvWorkspaceOrStorefrontTitle.text = "Storefront"
                binding.tvWorkspaceOrStorefrontSubtitle.text = "Customer menu & ordering catalog"
                binding.ivWorkspaceOrStorefrontIcon.setImageResource(R.drawable.ic_restaurant_menu)
            } else {
                // If in Storefront -> option to switch to Workspace
                binding.tvWorkspaceOrStorefrontTitle.text = "Workspace"
                binding.tvWorkspaceOrStorefrontSubtitle.text = "Store operations, orders & kitchen hub"
                binding.ivWorkspaceOrStorefrontIcon.setImageResource(R.drawable.ic_grid_view)
            }
        } else {
            binding.cardNavWorkspaceOrStorefront.visibility = View.GONE
            binding.cardNavSecurity.visibility = View.GONE
        }
    }

    private fun renderProfile() {
        if (!tokenManager.isLoggedIn()) {
            binding.layoutProfileGuest.visibility = View.VISIBLE
            binding.scrollProfileContent.visibility = View.GONE
            return
        }

        binding.layoutProfileGuest.visibility = View.GONE
        binding.scrollProfileContent.visibility = View.VISIBLE

        updateRoleActions()

        // 1. Instantly bind cached user details (name, email, phone, address) with zero network latency
        val cached = tokenManager.getUserProfile()
        if (cached != null) {
            bindUserProfile(cached)
        }

        // 2. Sync fresh details from backend in background (Stale-While-Revalidate)
        viewLifecycleOwner.lifecycleScope.launch {
            val result = apiClient.getMyProfile()
            if (result is NetworkResult.Success) {
                bindUserProfile(result.data)
                updateRoleActions()
            } else if (result is NetworkResult.Error && result.statusCode == 401) {
                tokenManager.clearSession()
                Toast.makeText(requireContext(), "Your session has expired. Please sign in again.", Toast.LENGTH_SHORT).show()
                renderProfile()
            }
        }
    }

    private fun bindUserProfile(user: User) {
        currentUser = user
        binding.tvUserName.text = user.name
        binding.tvUserEmail.text = user.email

        // Phone number prefixed with +91
        val cleanPhone = user.phone?.trim().orEmpty()
        if (cleanPhone.isNotBlank()) {
            val digits = cleanPhone.filter { it.isDigit() }.takeLast(10)
            binding.tvUserPhone.text = "+91 $digits"
        } else {
            binding.tvUserPhone.text = "+91 (Mobile not set)"
        }

        // Avatar initials
        val parts = user.name.trim().split(" ").filter { it.isNotBlank() }
        val initials = if (parts.size >= 2) {
            "${parts[0].take(1)}${parts[1].take(1)}".uppercase()
        } else {
            user.name.take(2).uppercase().ifBlank { "KZ" }
        }
        binding.tvUserInitials.text = initials

        // Selected address in one line bold without home/default prefixes
        val defaultAddr = user.addresses.firstOrNull { it.isDefault } ?: user.addresses.firstOrNull()
        if (defaultAddr != null && defaultAddr.isConfigured) {
            binding.tvSelectedAddressOneLine.text = defaultAddr.fullAddressText
        } else {
            binding.tvSelectedAddressOneLine.text = "No saved delivery addresses. Tap to add."
        }
    }
}
