package com.kebabzilla.ui.address

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.kebabzilla.R
import com.kebabzilla.data.model.Address
import com.kebabzilla.databinding.ItemSavedAddressBinding

class SavedAddressAdapter(
    private var addresses: List<Address> = emptyList(),
    private val onEditClick: (Address) -> Unit,
    private val onItemClick: (Address) -> Unit
) : RecyclerView.Adapter<SavedAddressAdapter.AddressViewHolder>() {

    fun updateData(newAddresses: List<Address>) {
        addresses = newAddresses
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): AddressViewHolder {
        val binding = ItemSavedAddressBinding.inflate(
            LayoutInflater.from(parent.context), parent, false
        )
        return AddressViewHolder(binding)
    }

    override fun onBindViewHolder(holder: AddressViewHolder, position: Int) {
        holder.bind(addresses[position])
    }

    override fun getItemCount(): Int = addresses.size

    inner class AddressViewHolder(private val binding: ItemSavedAddressBinding) :
        RecyclerView.ViewHolder(binding.root) {

        fun bind(address: Address) {
            // Category Icon
            when (address.label.trim().lowercase()) {
                "work" -> {
                    binding.ivAddressIcon.setImageResource(R.drawable.ic_work)
                }
                "other" -> {
                    binding.ivAddressIcon.setImageResource(R.drawable.ic_bookmark)
                }
                else -> {
                    binding.ivAddressIcon.setImageResource(R.drawable.ic_home)
                }
            }

            // Name
            binding.tvAddressLabel.text = address.label.ifBlank { "Home" }

            // Default Badge
            binding.tvDefaultBadge.visibility = if (address.isDefault) View.VISIBLE else View.GONE

            // Address Details or Collapsed if empty
            val hasDetails = listOfNotNull(address.houseNumber, address.road, address.area, address.city, address.pincode)
                .any { it.trim().isNotBlank() }

            if (hasDetails) {
                binding.tvFullAddress.visibility = View.VISIBLE
                binding.tvFullAddress.text = address.fullAddressText
            } else {
                binding.tvFullAddress.visibility = View.GONE
            }

            binding.btnEditAddress.setOnClickListener {
                onEditClick(address)
            }

            binding.root.setOnClickListener {
                onItemClick(address)
            }
        }
    }
}
