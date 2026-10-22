package com.kebabzilla.ui.profile

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.kebabzilla.R
import com.kebabzilla.data.api.ApiClient
import com.kebabzilla.data.api.NetworkResult
import com.kebabzilla.data.local.TokenManager
import com.kebabzilla.data.model.UserSession
import com.kebabzilla.databinding.ActivitySecurityBinding
import com.kebabzilla.ui.auth.AuthActivity
import kotlinx.coroutines.launch

class SecurityActivity : AppCompatActivity() {

    private lateinit var binding: ActivitySecurityBinding
    private lateinit var apiClient: ApiClient
    private lateinit var tokenManager: TokenManager
    private lateinit var sessionAdapter: UserSessionAdapter

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, true)
        binding = ActivitySecurityBinding.inflate(layoutInflater)
        setContentView(binding.root)

        apiClient = ApiClient(this)
        tokenManager = TokenManager(this)

        setupUI()
        loadSessions()
    }

    private fun setupUI() {
        binding.btnSecurityBack.setOnClickListener {
            finish()
        }

        sessionAdapter = UserSessionAdapter(emptyList()) { session ->
            confirmRevokeSession(session)
        }

        binding.rvOtherSessions.layoutManager = LinearLayoutManager(this)
        binding.rvOtherSessions.adapter = sessionAdapter

        binding.btnRevokeAllOtherSessions.setOnClickListener {
            confirmRevokeAllOthers()
        }
    }

    private fun loadSessions() {
        binding.progressSecurityLoading.visibility = View.VISIBLE
        lifecycleScope.launch {
            val result = apiClient.getUserSessions()
            binding.progressSecurityLoading.visibility = View.GONE

            if (result is NetworkResult.Success) {
                bindSessions(result.data)
            } else if (result is NetworkResult.Error) {
                Toast.makeText(this@SecurityActivity, result.message, Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun bindSessions(sessions: List<UserSession>) {
        val current = sessions.firstOrNull { it.isCurrent } ?: sessions.firstOrNull()
        val others = sessions.filter { it != current }

        if (current != null) {
            binding.cardCurrentSession.visibility = View.VISIBLE
            val ua = current.userAgent.orEmpty()
            val deviceTitle = when {
                ua.contains("Android", ignoreCase = true) -> "Android Device (Current App)"
                ua.contains("iPhone", ignoreCase = true) -> "iPhone"
                ua.contains("Windows", ignoreCase = true) -> "Windows PC"
                ua.contains("Macintosh", ignoreCase = true) -> "Mac"
                else -> "Mobile Device"
            }
            binding.tvCurrentDeviceName.text = deviceTitle
            binding.tvCurrentIpAddress.text = "IP: ${current.ipAddress ?: "Hidden"}"
            binding.tvCurrentLastActive.text = "Active now • Session ID: ${current.id.take(8)}..."
        }

        binding.tvOtherSessionsCount.text = "${others.size} active"
        if (others.isEmpty()) {
            binding.rvOtherSessions.visibility = View.GONE
            binding.tvNoOtherSessions.visibility = View.VISIBLE
            binding.btnRevokeAllOtherSessions.visibility = View.GONE
        } else {
            binding.rvOtherSessions.visibility = View.VISIBLE
            binding.tvNoOtherSessions.visibility = View.GONE
            binding.btnRevokeAllOtherSessions.visibility = View.VISIBLE
            sessionAdapter.updateSessions(others)
        }
    }

    private fun confirmRevokeSession(session: UserSession) {
        AlertDialog.Builder(this)
            .setTitle("Revoke Session")
            .setMessage("Are you sure you want to log out this device? It will require signing in again.")
            .setPositiveButton("Revoke") { dialog, _ ->
                dialog.dismiss()
                performRevokeSession(session)
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun performRevokeSession(session: UserSession) {
        binding.progressSecurityLoading.visibility = View.VISIBLE
        lifecycleScope.launch {
            val result = apiClient.revokeSession(session.id)
            binding.progressSecurityLoading.visibility = View.GONE

            if (result is NetworkResult.Success) {
                if (result.data) {
                    tokenManager.clearSession()
                    Toast.makeText(this@SecurityActivity, "Current session revoked. Please sign in.", Toast.LENGTH_LONG).show()
                    val intent = Intent(this@SecurityActivity, AuthActivity::class.java)
                    intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
                    startActivity(intent)
                    finish()
                } else {
                    Toast.makeText(this@SecurityActivity, "Session revoked successfully", Toast.LENGTH_SHORT).show()
                    loadSessions()
                }
            } else if (result is NetworkResult.Error) {
                Toast.makeText(this@SecurityActivity, result.message, Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun confirmRevokeAllOthers() {
        AlertDialog.Builder(this)
            .setTitle("Sign Out All Other Sessions")
            .setMessage("This will immediately invalidate all sessions on other devices and browsers. Do you want to continue?")
            .setPositiveButton("Sign Out All") { dialog, _ ->
                dialog.dismiss()
                performRevokeAllOthers()
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun performRevokeAllOthers() {
        binding.progressSecurityLoading.visibility = View.VISIBLE
        lifecycleScope.launch {
            val result = apiClient.revokeOtherSessions()
            binding.progressSecurityLoading.visibility = View.GONE

            if (result is NetworkResult.Success) {
                Toast.makeText(this@SecurityActivity, "All other sessions signed out", Toast.LENGTH_SHORT).show()
                loadSessions()
            } else if (result is NetworkResult.Error) {
                Toast.makeText(this@SecurityActivity, result.message, Toast.LENGTH_SHORT).show()
            }
        }
    }
}
