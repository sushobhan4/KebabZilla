package com.kebabzilla.ui.orders

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.RecyclerView
import com.kebabzilla.R
import com.kebabzilla.data.model.Order
import com.kebabzilla.databinding.ItemOrderCardBinding
import com.kebabzilla.utils.CurrencyFormatter

class OrderAdapter(
    private var orders: List<Order>
) : RecyclerView.Adapter<OrderAdapter.OrderViewHolder>() {

    inner class OrderViewHolder(val binding: ItemOrderCardBinding) :
        RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): OrderViewHolder {
        val binding = ItemOrderCardBinding.inflate(
            LayoutInflater.from(parent.context),
            parent,
            false
        )
        return OrderViewHolder(binding)
    }

    override fun onBindViewHolder(holder: OrderViewHolder, position: Int) {
        val order = orders[position]
        val binding = holder.binding
        val context = holder.itemView.context

        binding.tvOrderId.text = "Order #${order.orderId}"
        binding.tvOrderDate.text = order.createdAt ?: "Recent order"
        binding.tvOrderTotal.text = CurrencyFormatter.formatPaise(order.totalPaise)
        binding.tvOrderAddress.text = order.address ?: "Delivery address not recorded"

        // Status badge
        val statusText = order.status.replace("_", " ").uppercase()
        binding.tvOrderStatus.text = statusText
        when (order.status) {
            "DELIVERED" -> {
                binding.tvOrderStatus.setBackgroundResource(R.drawable.bg_status_open)
                binding.tvOrderStatus.setTextColor(ContextCompat.getColor(context, R.color.brand_green))
            }
            "CANCELLED" -> {
                binding.tvOrderStatus.setBackgroundResource(R.drawable.bg_status_closed)
                binding.tvOrderStatus.setTextColor(ContextCompat.getColor(context, R.color.brand_red))
            }
            else -> {
                binding.tvOrderStatus.setBackgroundResource(R.drawable.bg_category_chip_unselected)
                binding.tvOrderStatus.setTextColor(ContextCompat.getColor(context, R.color.brand_amber))
            }
        }

        // Active Order Experience: Delivery OTP, ETA, 5-Stage Timeline Stepper
        if (order.isActive) {
            binding.layoutTimeline.visibility = View.VISIBLE
            binding.layoutEta.visibility = View.VISIBLE

            // Delivery OTP Banner
            if (!order.deliveryOtp.isNullOrBlank()) {
                binding.layoutDeliveryOtp.visibility = View.VISIBLE
                val otp = order.deliveryOtp
                binding.tvDeliveryOtp.text = if (otp.length == 6) {
                    "${otp.substring(0, 3)} ${otp.substring(3)}"
                } else otp
            } else {
                binding.layoutDeliveryOtp.visibility = View.GONE
            }

            // Timeline states
            when (order.status) {
                "OUT_FOR_DELIVERY" -> {
                    binding.tvTimelineStage.text = "Stage 4 of 5"
                    binding.tvEtaTime.text = "8 - 12 mins"
                    binding.tvLiveStatusHint.text = "Approaching your gate"
                    binding.tvDistanceHint.text = "Distance: 1.4 km"
                    binding.layoutDriverCard.visibility = View.VISIBLE
                }
                "READY" -> {
                    binding.tvTimelineStage.text = "Stage 3 of 5"
                    binding.tvEtaTime.text = "12 - 15 mins"
                    binding.tvLiveStatusHint.text = "Heat-lock sealed"
                    binding.tvDistanceHint.text = "Assigning delivery rider"
                    binding.layoutDriverCard.visibility = View.GONE
                }
                "PREPARING" -> {
                    binding.tvTimelineStage.text = "Stage 2 of 5"
                    binding.tvEtaTime.text = "18 - 25 mins"
                    binding.tvLiveStatusHint.text = "Charcoal grill flame active"
                    binding.tvDistanceHint.text = "Fired to 380°C"
                    binding.layoutDriverCard.visibility = View.GONE
                }
                else -> {
                    binding.tvTimelineStage.text = "Stage 1 of 5"
                    binding.tvEtaTime.text = "25 - 30 mins"
                    binding.tvLiveStatusHint.text = "Order Received"
                    binding.tvDistanceHint.text = "Kitchen verifying"
                    binding.layoutDriverCard.visibility = View.GONE
                }
            }
        } else {
            binding.layoutTimeline.visibility = View.GONE
            binding.layoutEta.visibility = View.GONE
            binding.layoutDeliveryOtp.visibility = View.GONE
            binding.layoutDriverCard.visibility = View.GONE
        }

        // Items summary
        if (order.items.isNotEmpty()) {
            val summary = order.items.joinToString(", ") { "${it.quantity}x ${it.name}" }
            binding.tvOrderItemsSummary.text = summary
            binding.tvOrderItemsSummary.visibility = View.VISIBLE
        } else {
            binding.tvOrderItemsSummary.visibility = View.GONE
        }
    }

    override fun getItemCount(): Int = orders.size

    fun updateList(newOrders: List<Order>) {
        orders = newOrders
        notifyDataSetChanged()
    }
}
