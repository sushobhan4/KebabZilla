package com.kebabzilla.ui.menu

import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.RecyclerView
import coil.load
import com.kebabzilla.R
import com.kebabzilla.data.local.CartManager
import com.kebabzilla.data.model.MenuItem
import com.kebabzilla.databinding.ItemMenuFoodCardBinding
import com.kebabzilla.utils.CurrencyFormatter

class MenuItemAdapter(
    private var items: List<MenuItem>,
    private val onAddClick: (MenuItem) -> Unit,
    private val onPlusClick: (MenuItem) -> Unit,
    private val onMinusClick: (MenuItem) -> Unit
) : RecyclerView.Adapter<MenuItemAdapter.MenuItemViewHolder>() {

    private var isRestaurantOpen: Boolean = true
    private var isDeliveryOpen: Boolean = true

    val isOrderingClosed: Boolean
        get() = !isRestaurantOpen || !isDeliveryOpen

    fun setStoreStatus(isOpen: Boolean, isDelivery: Boolean) {
        val changed = this.isRestaurantOpen != isOpen || this.isDeliveryOpen != isDelivery
        this.isRestaurantOpen = isOpen
        this.isDeliveryOpen = isDelivery
        if (changed) {
            notifyDataSetChanged()
        }
    }

    inner class MenuItemViewHolder(val binding: ItemMenuFoodCardBinding) :
        RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): MenuItemViewHolder {
        val binding = ItemMenuFoodCardBinding.inflate(
            LayoutInflater.from(parent.context),
            parent,
            false
        )
        return MenuItemViewHolder(binding)
    }

    override fun onBindViewHolder(holder: MenuItemViewHolder, position: Int) {
        val item = items[position]
        val binding = holder.binding
        val context = holder.itemView.context

        binding.tvFoodName.text = item.name

        // Proper discount & pricing display
        val isVariablePrice = item.hasVariations || item.isCustomizable
        val hasDiscount = item.discountedPricePaise != null && item.discountedPricePaise < item.pricePaise
        val activePricePaise = item.discountedPricePaise ?: item.pricePaise

        if (isVariablePrice) {
            binding.tvFoodPrice.text = "From ${CurrencyFormatter.formatPaise(activePricePaise)}"
        } else {
            binding.tvFoodPrice.text = CurrencyFormatter.formatPaise(activePricePaise)
        }

        if (hasDiscount) {
            binding.tvFoodOriginalPrice.visibility = View.VISIBLE
            binding.tvFoodOriginalPrice.text = CurrencyFormatter.formatPaise(item.pricePaise)
            binding.tvFoodOriginalPrice.paintFlags = binding.tvFoodOriginalPrice.paintFlags or Paint.STRIKE_THRU_TEXT_FLAG
        } else {
            binding.tvFoodOriginalPrice.visibility = View.GONE
        }

        if (!item.description.isNullOrBlank()) {
            binding.tvFoodDescription.text = item.description
            binding.tvFoodDescription.visibility = View.VISIBLE
        } else {
            binding.tvFoodDescription.visibility = View.GONE
        }

        // Dietary indicator on bottom-right of picture (Veg: Squared green plant / Non-veg: Squared red circle)
        binding.ivDietaryBadge.setImageResource(
            if (item.isVegetarian) R.drawable.bg_diet_dot_veg else R.drawable.bg_diet_dot_nonveg
        )

        // Discount campaign badge (e.g. "KZ SPECIAL", "20% OFF")
        if (!item.discountCampaignName.isNullOrBlank() && !item.discountCampaignName.equals("null", ignoreCase = true)) {
            binding.tvDiscountBadge.visibility = View.VISIBLE
            binding.tvDiscountBadge.text = item.discountCampaignName
        } else if (item.discountPercent > 0) {
            binding.tvDiscountBadge.visibility = View.VISIBLE
            binding.tvDiscountBadge.text = "${item.discountPercent}% OFF"
        } else {
            binding.tvDiscountBadge.visibility = View.GONE
        }

        // Zilla Pick Badge
        if (item.isFeatured) {
            binding.tvZillaPickBadge.visibility = View.VISIBLE
        } else {
            binding.tvZillaPickBadge.visibility = View.GONE
        }

        // Customizable Badge
        if (item.isCustomizable) {
            binding.tvCustomizableBadge.visibility = View.VISIBLE
        } else {
            binding.tvCustomizableBadge.visibility = View.GONE
        }

        // Food image with Coil
        if (!item.imageUrl.isNullOrBlank()) {
            binding.ivFoodImage.load(item.imageUrl) {
                crossfade(true)
                placeholder(R.drawable.kebabzilla_mark)
                error(R.drawable.kebabzilla_mark)
            }
        } else {
            binding.ivFoodImage.setImageResource(R.drawable.kebabzilla_mark)
        }

        // Check if item or store is unavailable/closed
        val isUnavailable = isOrderingClosed || item.isPaused || !item.isAvailable

        if (isUnavailable) {
            // Completely desaturate the menu to black and white when order is not available or shop closes
            binding.root.alpha = 0.58f

            val matrix = ColorMatrix().apply {
                setSaturation(0.0f) // 100% Black & White desaturation
            }
            binding.ivFoodImage.colorFilter = ColorMatrixColorFilter(matrix)

            // Hide ordering actions, show closed label
            binding.btnAdd.visibility = View.GONE
            binding.layoutStepper.visibility = View.GONE
            binding.tvClosedLabel.visibility = View.VISIBLE
            binding.tvClosedLabel.text = when {
                !isRestaurantOpen -> "Closed"
                !isDeliveryOpen -> "Walk-in only"
                item.isPaused || !item.isAvailable -> "Unavailable"
                else -> "Closed"
            }

            binding.btnAdd.setOnClickListener(null)
            binding.btnPlus.setOnClickListener(null)
            binding.btnMinus.setOnClickListener(null)
            binding.root.setOnClickListener(null)
        } else {
            binding.root.alpha = 1.0f
            binding.ivFoodImage.colorFilter = null
            binding.tvClosedLabel.visibility = View.GONE

            // Cart quantity handling
            val inCartQty = CartManager.getItemQuantity(item.id)
            if (inCartQty > 0) {
                binding.btnAdd.visibility = View.GONE
                binding.layoutStepper.visibility = View.VISIBLE
                binding.tvQuantity.text = inCartQty.toString()
            } else {
                binding.btnAdd.visibility = View.VISIBLE
                binding.layoutStepper.visibility = View.GONE

                if (item.isCustomizable) {
                    binding.tvAddText.text = "Customise"
                    binding.ivAddIcon.setImageResource(R.drawable.ic_tune)
                } else if (item.hasVariations) {
                    binding.tvAddText.text = item.variationActionText
                    binding.ivAddIcon.setImageResource(R.drawable.ic_tune)
                } else {
                    binding.tvAddText.text = "Add"
                    binding.ivAddIcon.setImageResource(R.drawable.ic_add)
                }
            }

            binding.btnAdd.setOnClickListener {
                onAddClick(item)
            }

            binding.btnPlus.setOnClickListener {
                onPlusClick(item)
            }

            binding.btnMinus.setOnClickListener {
                onMinusClick(item)
            }

            binding.root.setOnClickListener {
                onAddClick(item)
            }
        }
    }

    override fun getItemCount(): Int = items.size

    fun updateList(newItems: List<MenuItem>) {
        items = newItems
        notifyDataSetChanged()
    }
}
