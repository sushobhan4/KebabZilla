package com.kebabzilla.ui.cart

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import coil.load
import com.kebabzilla.R
import com.kebabzilla.data.local.CartManager
import com.kebabzilla.data.model.CartLine
import com.kebabzilla.databinding.ItemCartLineBinding
import com.kebabzilla.utils.CurrencyFormatter

class CartItemAdapter(
    private var lines: List<CartLine>
) : RecyclerView.Adapter<CartItemAdapter.CartItemViewHolder>() {

    inner class CartItemViewHolder(val binding: ItemCartLineBinding) :
        RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): CartItemViewHolder {
        val binding = ItemCartLineBinding.inflate(
            LayoutInflater.from(parent.context),
            parent,
            false
        )
        return CartItemViewHolder(binding)
    }

    override fun onBindViewHolder(holder: CartItemViewHolder, position: Int) {
        val line = lines[position]
        val binding = holder.binding

        binding.tvCartItemName.text = line.menuItem.name
        binding.tvCartItemPrice.text = CurrencyFormatter.formatPaise(line.lineTotalPaise)
        binding.tvCartQuantity.text = line.quantity.toString()

        if (!line.variationName.isNullOrBlank()) {
            binding.tvCartItemVariation.text = line.variationName
            binding.tvCartItemVariation.visibility = View.VISIBLE
        } else {
            binding.tvCartItemVariation.visibility = View.GONE
        }

        // Dietary
        if (line.menuItem.isVegetarian) {
            binding.ivCartDietaryIcon.setImageResource(R.drawable.ic_veg)
        } else {
            binding.ivCartDietaryIcon.setImageResource(R.drawable.ic_non_veg)
        }

        // Image
        if (!line.menuItem.imageUrl.isNullOrBlank()) {
            binding.ivCartItemImage.load(line.menuItem.imageUrl) {
                crossfade(true)
                placeholder(R.drawable.kebabzilla_mark)
                error(R.drawable.kebabzilla_mark)
            }
        } else {
            binding.ivCartItemImage.setImageResource(R.drawable.kebabzilla_mark)
        }

        binding.btnCartPlus.setOnClickListener {
            CartManager.updateQuantity(line.lineKey, line.quantity + 1)
        }

        binding.btnCartMinus.setOnClickListener {
            CartManager.updateQuantity(line.lineKey, line.quantity - 1)
        }

        binding.btnCartDelete.setOnClickListener {
            CartManager.removeLine(line.lineKey)
        }
    }

    override fun getItemCount(): Int = lines.size

    fun updateList(newLines: List<CartLine>) {
        lines = newLines
        notifyDataSetChanged()
    }
}
