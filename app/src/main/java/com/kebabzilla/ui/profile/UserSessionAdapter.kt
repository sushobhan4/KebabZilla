package com.kebabzilla.ui.profile

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.kebabzilla.R
import com.kebabzilla.data.model.UserSession
import com.kebabzilla.databinding.ItemUserSessionBinding

class UserSessionAdapter(
    private var sessions: List<UserSession>,
    private val onRevokeClick: (UserSession) -> Unit
) : RecyclerView.Adapter<UserSessionAdapter.SessionViewHolder>() {

    fun updateSessions(newSessions: List<UserSession>) {
        sessions = newSessions
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): SessionViewHolder {
        val binding = ItemUserSessionBinding.inflate(
            LayoutInflater.from(parent.context),
            parent,
            false
        )
        return SessionViewHolder(binding)
    }

    override fun onBindViewHolder(holder: SessionViewHolder, position: Int) {
        holder.bind(sessions[position])
    }

    override fun getItemCount(): Int = sessions.size

    inner class SessionViewHolder(private val binding: ItemUserSessionBinding) :
        RecyclerView.ViewHolder(binding.root) {

        fun bind(session: UserSession) {
            val ua = session.userAgent.orEmpty()
            val deviceTitle = when {
                ua.contains("Android", ignoreCase = true) -> "Android Device"
                ua.contains("iPhone", ignoreCase = true) -> "iPhone"
                ua.contains("Windows", ignoreCase = true) -> "Windows PC"
                ua.contains("Macintosh", ignoreCase = true) -> "Mac"
                ua.contains("Linux", ignoreCase = true) -> "Linux Device"
                else -> "Web Browser"
            }
            binding.tvSessionDeviceTitle.text = deviceTitle
            binding.tvSessionIp.text = "IP: ${session.ipAddress ?: "Hidden"}"
            binding.tvSessionLastActive.text = "Last active: ${session.lastActive ?: "Recently"}"

            if (ua.contains("Windows") || ua.contains("Mac") || ua.contains("Linux")) {
                binding.ivSessionDeviceIcon.setImageResource(R.drawable.ic_grid_view)
            } else {
                binding.ivSessionDeviceIcon.setImageResource(R.drawable.ic_phone_android)
            }

            binding.btnRevokeSession.setOnClickListener {
                onRevokeClick(session)
            }
        }
    }
}
