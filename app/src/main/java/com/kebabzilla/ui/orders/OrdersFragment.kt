package com.kebabzilla.ui.orders

import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.kebabzilla.MainActivity
import com.kebabzilla.data.api.ApiClient
import com.kebabzilla.data.api.NetworkResult
import com.kebabzilla.data.local.TokenManager
import com.kebabzilla.databinding.FragmentOrdersBinding
import com.kebabzilla.ui.auth.AuthActivity
import kotlinx.coroutines.launch

class OrdersFragment : Fragment() {

    private var _binding: FragmentOrdersBinding? = null
    private val binding get() = _binding!!

    private lateinit var apiClient: ApiClient
    private lateinit var tokenManager: TokenManager
    private lateinit var orderAdapter: OrderAdapter

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentOrdersBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        apiClient = ApiClient(requireContext())
        tokenManager = TokenManager(requireContext())

        setupRecyclerView()
        setupListeners()
    }

    override fun onResume() {
        super.onResume()
        checkAndLoadOrders()
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }

    private fun setupRecyclerView() {
        orderAdapter = OrderAdapter(emptyList())
        binding.rvOrders.apply {
            layoutManager = LinearLayoutManager(context)
            adapter = orderAdapter
        }
    }

    private fun setupListeners() {
        binding.btnOrdersBack.setOnClickListener {
            (activity as? MainActivity)?.showStorefront()
        }

        binding.swipeRefreshOrders.setOnRefreshListener {
            checkAndLoadOrders()
        }

        binding.btnOrdersSignIn.setOnClickListener {
            startActivity(Intent(requireContext(), AuthActivity::class.java))
        }
    }

    private fun checkAndLoadOrders() {
        if (!tokenManager.isLoggedIn()) {
            binding.layoutOrdersNotLoggedIn.visibility = View.VISIBLE
            binding.layoutOrdersEmpty.visibility = View.GONE
            binding.rvOrders.visibility = View.GONE
            binding.pbOrders.visibility = View.GONE
            binding.swipeRefreshOrders.isRefreshing = false
            return
        }

        binding.layoutOrdersNotLoggedIn.visibility = View.GONE
        binding.pbOrders.visibility = View.VISIBLE

        viewLifecycleOwner.lifecycleScope.launch {
            val result = apiClient.getMyOrders()
            binding.pbOrders.visibility = View.GONE
            binding.swipeRefreshOrders.isRefreshing = false

            when (result) {
                is NetworkResult.Success -> {
                    val orders = result.data
                    if (orders.isEmpty()) {
                        binding.layoutOrdersEmpty.visibility = View.VISIBLE
                        binding.rvOrders.visibility = View.GONE
                    } else {
                        binding.layoutOrdersEmpty.visibility = View.GONE
                        binding.rvOrders.visibility = View.VISIBLE
                        orderAdapter.updateList(orders)
                    }
                }
                is NetworkResult.Error -> {
                    if (result.statusCode == 401) {
                        tokenManager.clearSession()
                        Toast.makeText(requireContext(), "Your session has expired. Please sign in again.", Toast.LENGTH_SHORT).show()
                        checkAndLoadOrders()
                    } else {
                        Toast.makeText(requireContext(), result.message, Toast.LENGTH_SHORT).show()
                    }
                }
                is NetworkResult.Loading -> {}
            }
        }
    }
}
