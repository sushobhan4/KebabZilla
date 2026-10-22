package com.kebabzilla.ui.menu

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.RecyclerView
import com.kebabzilla.R
import com.kebabzilla.databinding.ItemCategoryChipBinding

class CategoryAdapter(
    private var categories: List<String>,
    private var selectedCategory: String,
    private val onCategoryClick: (String) -> Unit
) : RecyclerView.Adapter<CategoryAdapter.CategoryViewHolder>() {

    inner class CategoryViewHolder(val binding: ItemCategoryChipBinding) :
        RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): CategoryViewHolder {
        val binding = ItemCategoryChipBinding.inflate(
            LayoutInflater.from(parent.context),
            parent,
            false
        )
        return CategoryViewHolder(binding)
    }

    override fun onBindViewHolder(holder: CategoryViewHolder, position: Int) {
        val category = categories[position]
        val isSelected = category.equals(selectedCategory, ignoreCase = true)

        holder.binding.tvCategoryName.text = category
        if (isSelected) {
            holder.binding.tvCategoryName.setBackgroundResource(R.drawable.bg_category_chip_selected)
            holder.binding.tvCategoryName.setTextColor(
                ContextCompat.getColor(holder.itemView.context, R.color.white)
            )
        } else {
            holder.binding.tvCategoryName.setBackgroundResource(R.drawable.bg_category_chip_unselected)
            holder.binding.tvCategoryName.setTextColor(
                ContextCompat.getColor(holder.itemView.context, R.color.brand_ink)
            )
        }

        holder.itemView.setOnClickListener {
            if (!isSelected) {
                selectedCategory = category
                notifyDataSetChanged()
                onCategoryClick(category)
            }
        }
    }

    override fun getItemCount(): Int = categories.size

    fun updateCategories(newCategories: List<String>, currentSelected: String) {
        categories = newCategories
        selectedCategory = currentSelected
        notifyDataSetChanged()
    }
}
