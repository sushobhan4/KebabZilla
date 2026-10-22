package com.kebabzilla.ui.workspace

import android.graphics.Color
import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.RecyclerView
import com.kebabzilla.R
import com.kebabzilla.databinding.ItemWorkspaceGridCardBinding
import com.kebabzilla.databinding.ItemWorkspaceListCardBinding

data class WorkspaceTabItem(
    val key: String,
    val title: String,
    val subtitle: String,
    val iconRes: Int,
    var badgeText: String,
    val tone: WorkspaceCardTone = WorkspaceCardTone.DEFAULT,
    val fullWidth: Boolean = false
)

enum class WorkspaceCardTone {
    DEFAULT,
    GREEN,
    AMBER,
    PLUM
}

class WorkspaceTabAdapter(
    private var items: List<WorkspaceTabItem>,
    private var isGridView: Boolean = true,
    private val onTabClick: (WorkspaceTabItem) -> Unit
) : RecyclerView.Adapter<RecyclerView.ViewHolder>() {

    companion object {
        const val VIEW_TYPE_GRID = 0
        const val VIEW_TYPE_LIST = 1

        const val TAB_OVERVIEW = "OVERVIEW"
        const val TAB_ORDER = "ORDER"
        const val TAB_MENU = "MENU"
        const val TAB_PEOPLE = "PEOPLE"
        const val TAB_ACTIVITY = "ACTIVITY"
        const val TAB_BROADCAST = "BROADCAST"
        const val TAB_DISCOUNT = "DISCOUNT"
        const val TAB_ORDER_QUEUE = "ORDER_QUEUE"
        const val TAB_BILLING = "BILLING"
        const val TAB_MENU_AVAILABILITY = "MENU_AVAILABILITY"
        const val TAB_DELIVERY_QUEUE = "DELIVERY_QUEUE"
        const val TAB_REPORTS = "REPORTS"
        const val TAB_SETTINGS = "SETTINGS"
    }

    fun setGridView(isGrid: Boolean) {
        if (this.isGridView != isGrid) {
            this.isGridView = isGrid
            notifyDataSetChanged()
        }
    }

    fun updateItems(newItems: List<WorkspaceTabItem>) {
        this.items = newItems
        notifyDataSetChanged()
    }

    override fun getItemViewType(position: Int): Int {
        return if (isGridView) VIEW_TYPE_GRID else VIEW_TYPE_LIST
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
        val inflater = LayoutInflater.from(parent.context)
        return if (viewType == VIEW_TYPE_GRID) {
            val binding = ItemWorkspaceGridCardBinding.inflate(inflater, parent, false)
            GridViewHolder(binding)
        } else {
            val binding = ItemWorkspaceListCardBinding.inflate(inflater, parent, false)
            ListViewHolder(binding)
        }
    }

    override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
        val item = items[position]
        if (holder is GridViewHolder) {
            holder.bind(item)
        } else if (holder is ListViewHolder) {
            holder.bind(item)
        }
    }

    override fun getItemCount(): Int = items.size

    inner class GridViewHolder(private val binding: ItemWorkspaceGridCardBinding) :
        RecyclerView.ViewHolder(binding.root) {

        fun bind(item: WorkspaceTabItem) {
            binding.tvTabTitle.text = item.title
            binding.tvTabSubtitle.text = item.subtitle
            binding.ivTabIcon.setImageResource(item.iconRes)
            binding.tvTabBadge.text = item.badgeText

            applyToneStyles(
                tone = item.tone,
                card = binding.cardWorkspaceRoot,
                iconBox = binding.layoutIconBox,
                icon = binding.ivTabIcon,
                badge = binding.tvTabBadge
            )

            binding.cardWorkspaceRoot.setOnClickListener {
                onTabClick(item)
            }
        }
    }

    inner class ListViewHolder(private val binding: ItemWorkspaceListCardBinding) :
        RecyclerView.ViewHolder(binding.root) {

        fun bind(item: WorkspaceTabItem) {
            binding.tvTabTitle.text = item.title
            binding.tvTabSubtitle.text = item.subtitle
            binding.ivTabIcon.setImageResource(item.iconRes)
            binding.tvTabBadge.text = item.badgeText

            applyToneStyles(
                tone = item.tone,
                card = binding.cardWorkspaceRoot,
                iconBox = binding.layoutIconBox,
                icon = binding.ivTabIcon,
                badge = binding.tvTabBadge
            )

            binding.cardWorkspaceRoot.setOnClickListener {
                onTabClick(item)
            }
        }
    }

    private fun applyToneStyles(
        tone: WorkspaceCardTone,
        card: com.google.android.material.card.MaterialCardView,
        iconBox: android.view.View,
        icon: android.widget.ImageView,
        badge: android.widget.TextView
    ) {
        val context = card.context
        when (tone) {
            WorkspaceCardTone.GREEN -> {
                card.strokeColor = Color.parseColor("#86EFAC")
                card.strokeWidth = (1.5f * context.resources.displayMetrics.density).toInt()
                iconBox.setBackgroundColor(Color.parseColor("#DCFCE7"))
                icon.setColorFilter(Color.parseColor("#16A34A"))
                badge.setBackgroundColor(Color.parseColor("#DCFCE7"))
                badge.setTextColor(Color.parseColor("#16A34A"))
            }
            WorkspaceCardTone.AMBER -> {
                card.strokeColor = Color.parseColor("#FDE68A")
                card.strokeWidth = (1.5f * context.resources.displayMetrics.density).toInt()
                iconBox.setBackgroundColor(Color.parseColor("#FEF3C7"))
                icon.setColorFilter(Color.parseColor("#D97706"))
                badge.setBackgroundColor(Color.parseColor("#FEF3C7"))
                badge.setTextColor(Color.parseColor("#D97706"))
            }
            WorkspaceCardTone.PLUM -> {
                card.strokeColor = Color.parseColor("#DDD6FE")
                card.strokeWidth = (1.5f * context.resources.displayMetrics.density).toInt()
                iconBox.setBackgroundColor(Color.parseColor("#EDE9FE"))
                icon.setColorFilter(Color.parseColor("#7C3AED"))
                badge.setBackgroundColor(Color.parseColor("#EDE9FE"))
                badge.setTextColor(Color.parseColor("#7C3AED"))
            }
            WorkspaceCardTone.DEFAULT -> {
                card.strokeColor = ContextCompat.getColor(context, R.color.brand_line)
                card.strokeWidth = (1f * context.resources.displayMetrics.density).toInt()
                iconBox.background = ContextCompat.getDrawable(context, R.drawable.bg_pill_white)
                icon.setColorFilter(ContextCompat.getColor(context, R.color.brand_ink))
                badge.background = ContextCompat.getDrawable(context, R.drawable.bg_pill_white)
                badge.setTextColor(ContextCompat.getColor(context, R.color.brand_muted))
            }
        }
    }
}
