package com.kebabzilla.data.api

import android.content.Context
import com.kebabzilla.data.local.DataCacheManager
import com.kebabzilla.data.local.TokenManager
import com.kebabzilla.data.model.*
import com.kebabzilla.utils.Constants
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class ApiClient(private val context: Context) {

    private val tokenManager = TokenManager(context)
    private val cacheManager = DataCacheManager(context)
    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    private val client: OkHttpClient = OkHttpClient.Builder()
        .followRedirects(true)
        .followSslRedirects(true)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .build()

    fun resolveImageUrl(rawUrl: String?): String? {
        if (rawUrl.isNullOrBlank()) return null
        val trimmed = rawUrl.trim()
        if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("data:")) {
            return trimmed
        }
        val cleanBase = Constants.DEFAULT_BASE_URL.trimEnd('/')
        return if (trimmed.startsWith("/")) "$cleanBase$trimmed" else "$cleanBase/$trimmed"
    }

    fun parseErrorDetail(body: String?, defaultMsg: String, statusCode: Int): String {
        if (body.isNullOrBlank()) return "$defaultMsg ($statusCode)"
        return try {
            val json = JSONObject(body)
            if (json.has("detail")) {
                val detailObj = json.get("detail")
                if (detailObj is String && detailObj.isNotBlank()) {
                    detailObj
                } else if (detailObj is JSONArray && detailObj.length() > 0) {
                    val firstErr = detailObj.getJSONObject(0)
                    val msg = firstErr.optString("msg", defaultMsg)
                    val locArray = firstErr.optJSONArray("loc")
                    val fieldName = if (locArray != null && locArray.length() > 0) {
                        val last = locArray.optString(locArray.length() - 1)
                        if (last.toIntOrNull() != null && locArray.length() > 1) {
                            locArray.optString(locArray.length() - 2)
                        } else {
                            last
                        }
                    } else null
                    if (!fieldName.isNullOrBlank() && fieldName != "body") {
                        "$fieldName: $msg"
                    } else {
                        msg
                    }
                } else {
                    "$defaultMsg ($statusCode)"
                }
            } else if (json.has("message")) {
                json.getString("message")
            } else {
                "$defaultMsg ($statusCode)"
            }
        } catch (_: Exception) {
            "$defaultMsg ($statusCode)"
        }
    }

    private fun executeRequest(
        path: String,
        method: String = "GET",
        body: RequestBody? = null
    ): Response {
        val cleanPath = path.removePrefix("/")
        val fullUrl = "${Constants.DEFAULT_BASE_URL}$cleanPath"

        val builder = Request.Builder()
            .url(fullUrl)
            .addHeader("User-Agent", "KebabZilla-Android/1.0")

        val token = tokenManager.getAccessToken()
        if (!token.isNullOrBlank()) {
            builder.addHeader("Authorization", "Bearer $token")
        }
        val csrf = tokenManager.getCsrfToken()
        if (!csrf.isNullOrBlank()) {
            builder.addHeader("X-CSRF-Token", csrf)
        }
        when (method.uppercase()) {
            "POST" -> builder.post(body ?: "".toRequestBody(jsonMediaType))
            "PUT" -> builder.put(body ?: "".toRequestBody(jsonMediaType))
            "PATCH" -> builder.patch(body ?: "".toRequestBody(jsonMediaType))
            "DELETE" -> builder.delete(body)
            else -> builder.get()
        }

        return client.newCall(builder.build()).execute()
    }

    suspend fun getRestaurantInfo(): NetworkResult<RestaurantInfo> = withContext(Dispatchers.IO) {
        try {
            executeRequest("restaurant").use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful && body.isNotBlank()) {
                    val json = JSONObject(body)
                    val customReason = json.optString("delivery_paused_reason").takeIf { it.isNotBlank() }
                        ?: json.optString("delivery_status_heading").takeIf { it.isNotBlank() }
                    val info = RestaurantInfo(
                        name = json.optString("restaurant_name", "KebabZilla"),
                        tagline = json.optString("tagline", "Authentic Kebabs & Fast Casual Dining"),
                        phone = json.optString("phone").takeIf { it.isNotBlank() },
                        email = json.optString("email", "support@kebabzilla.in"),
                        address = json.optString("address", "Amtala, DH Road, South 24 Parganas"),
                        latitude = if (json.has("latitude") && !json.isNull("latitude")) json.optDouble("latitude") else Constants.RESTAURANT_LATITUDE,
                        longitude = if (json.has("longitude") && !json.isNull("longitude")) json.optDouble("longitude") else Constants.RESTAURANT_LONGITUDE,
                        isRestaurantOpen = json.optBoolean("is_restaurant_open", true),
                        isDeliveryOpen = json.optBoolean("is_delivery_open", true),
                        deliveryRadiusKm = json.optDouble("delivery_radius_km", 10.0),
                        freeDeliveryRadiusKm = json.optDouble("free_delivery_radius_km", 3.0),
                        freeDeliveryThresholdPaise = json.optLong("free_delivery_threshold_paise", 0L),
                        deliveryFeePerKmPaise = json.optLong("delivery_fee_per_km_paise", 0L),
                        chargeFromZeroBeyondFreeRadius = json.optBoolean("charge_from_zero_beyond_free_radius", false),
                        deliveryStatusHeading = customReason,
                        deliveryStatusMessage = json.optString("delivery_status_message").takeIf { it.isNotBlank() },
                        closingInMinutes = if (json.has("closing_in_minutes") && !json.isNull("closing_in_minutes")) json.optInt("closing_in_minutes") else null,
                        cutoffInMinutes = if (json.has("cutoff_in_minutes") && !json.isNull("cutoff_in_minutes")) json.optInt("cutoff_in_minutes") else null,
                        closingTime = json.optString("closing_time").takeIf { it.isNotBlank() }
                    )
                    // Persist to local cache immediately
                    cacheManager.saveRestaurantState(info, body, null, null)
                    NetworkResult.Success(info)
                } else {
                    NetworkResult.Error("Restaurant status unavailable (${response.code})", response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Network connection error")
        }
    }

    suspend fun getMenuItems(): NetworkResult<List<MenuItem>> = withContext(Dispatchers.IO) {
        try {
            executeRequest("menu").use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful && body.isNotBlank()) {
                    val list = DataCacheManager.parseMenuItemsJson(body) { resolveImageUrl(it) }
                    // Persist to local cache immediately
                    cacheManager.saveMenuItemsRaw(body)
                    NetworkResult.Success(list)
                } else {
                    NetworkResult.Error("Failed to fetch menu items (${response.code})", response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Failed to connect to menu service")
        }
    }

    suspend fun getCustomMenuItems(): NetworkResult<List<MenuItem>> = withContext(Dispatchers.IO) {
        try {
            executeRequest("custom-menu").use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful && body.isNotBlank()) {
                    val list = DataCacheManager.parseCustomMenuItemsJson(body) { resolveImageUrl(it) }
                    // Persist to local cache immediately
                    cacheManager.saveCustomMenuItemsRaw(body)
                    NetworkResult.Success(list)
                } else {
                    NetworkResult.Error("Failed to fetch custom menu items (${response.code})", response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Failed to connect to custom menu service")
        }
    }

    suspend fun getAllMenuItemsCombined(): NetworkResult<List<MenuItem>> = withContext(Dispatchers.IO) {
        val standardDeferred = async { getMenuItems() }
        val customDeferred = async { getCustomMenuItems() }

        val stdResult = standardDeferred.await()
        val customResult = customDeferred.await()

        val combined = mutableListOf<MenuItem>()
        val seenIds = mutableSetOf<Long>()

        if (stdResult is NetworkResult.Success) {
            stdResult.data.forEach {
                if (seenIds.add(it.id)) combined.add(it)
            }
        }
        if (customResult is NetworkResult.Success) {
            customResult.data.forEach {
                if (seenIds.add(it.id)) combined.add(it)
            }
        }

        if (combined.isNotEmpty()) {
            NetworkResult.Success(combined)
        } else if (stdResult is NetworkResult.Error) {
            stdResult
        } else if (customResult is NetworkResult.Error) {
            customResult
        } else {
            NetworkResult.Success(emptyList())
        }
    }

    suspend fun getRemoteCart(): NetworkResult<List<RemoteCartItem>> = withContext(Dispatchers.IO) {
        try {
            executeRequest("cart").use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful) {
                    val list = mutableListOf<RemoteCartItem>()
                    if (body.isNotBlank()) {
                        val array = JSONArray(body)
                        for (i in 0 until array.length()) {
                            val obj = array.getJSONObject(i)
                            val menuId = if (obj.has("menu_item_id") && !obj.isNull("menu_item_id")) {
                                obj.optLong("menu_item_id")
                            } else {
                                obj.optLong("menu_id")
                            }
                            list.add(
                                RemoteCartItem(
                                    id = if (obj.has("id")) obj.optLong("id") else null,
                                    menuId = menuId,
                                    variationName = obj.optString("variation_name").takeIf { it.isNotBlank() },
                                    quantity = obj.optInt("quantity", 1),
                                    unitPricePaise = obj.optLong("unit_price_paise", 0L)
                                )
                            )
                        }
                    }
                    NetworkResult.Success(list)
                } else {
                    NetworkResult.Error("Could not fetch remote cart (${response.code})", response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Network error fetching remote cart")
        }
    }

    suspend fun syncRemoteCart(lines: List<CartLine>): NetworkResult<Unit> = withContext(Dispatchers.IO) {
        try {
            val array = JSONArray()
            for (line in lines) {
                val obj = JSONObject().apply {
                    put("menu_item_id", line.menuItem.id)
                    put("quantity", line.quantity)
                    if (!line.variationName.isNullOrBlank()) {
                        put("variation_name", line.variationName)
                    }
                    put("unit_price_paise", line.unitPricePaise)
                    put("customizations", JSONArray())
                }
                array.put(obj)
            }
            executeRequest(
                path = "cart",
                method = "PUT",
                body = array.toString().toRequestBody(jsonMediaType)
            ).use { response ->
                if (response.isSuccessful) {
                    NetworkResult.Success(Unit)
                } else {
                    NetworkResult.Error("Could not sync remote cart (${response.code})", response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Network error syncing cart")
        }
    }

    suspend fun clearRemoteCart(): NetworkResult<Unit> = withContext(Dispatchers.IO) {
        try {
            executeRequest(
                path = "cart",
                method = "DELETE"
            ).use { response ->
                if (response.isSuccessful) {
                    NetworkResult.Success(Unit)
                } else {
                    NetworkResult.Error("Could not clear remote cart (${response.code})", response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Network error clearing remote cart")
        }
    }

    suspend fun login(email: String, password: String): NetworkResult<AuthResponse> = withContext(Dispatchers.IO) {
        try {
            val jsonBody = JSONObject().apply {
                put("email", email)
                put("password", password)
            }
            executeRequest(
                path = "auth/login",
                method = "POST",
                body = jsonBody.toString().toRequestBody(jsonMediaType)
            ).use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful && body.isNotBlank()) {
                    val obj = JSONObject(body)

                    if (obj.optBoolean("requires_2fa", false) || obj.has("temp_token")) {
                        val tempToken = obj.optString("temp_token")
                        val emailVal = obj.optString("email", email)
                        val roleVal = obj.optString("role", Constants.ROLE_STAFF)
                        return@withContext NetworkResult.Success(
                            AuthResponse(
                                requires2Fa = true,
                                tempToken = tempToken,
                                email = emailVal,
                                role = roleVal
                            )
                        )
                    }

                    val token = obj.optString("access_token")
                    val csrf = obj.optString("csrf_token")
                    val accountObj = obj.optJSONObject("account")
                    val emailVal = accountObj?.optString("email") ?: obj.optString("email", email)
                    val nameVal = accountObj?.optString("name") ?: obj.optString("name", "Customer")
                    val roleVal = accountObj?.optString("role") ?: obj.optString("role", Constants.ROLE_USER)
                    val userIdVal = accountObj?.optLong("id") ?: obj.optLong("id", 1L)

                    val phoneVal = accountObj?.optString("phone").takeIf { !it.isNullOrBlank() }

                    tokenManager.saveAccessToken(token)
                    if (csrf.isNotBlank()) {
                        tokenManager.saveCsrfToken(csrf)
                    }
                    tokenManager.saveUserRole(roleVal)
                    tokenManager.saveUserEmail(emailVal)
                    tokenManager.saveUserName(nameVal)
                    tokenManager.saveUserPhone(phoneVal)

                    val user = User(
                        id = userIdVal,
                        name = nameVal,
                        email = emailVal,
                        phone = phoneVal,
                        role = roleVal
                    )
                    tokenManager.saveUserProfile(user)
                    NetworkResult.Success(AuthResponse(accessToken = token, user = user))
                } else {
                    val errorDetail = parseErrorDetail(body, "Login failed", response.code)
                    NetworkResult.Error(errorDetail, response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Unable to connect for login")
        }
    }

    suspend fun googleLogin(credential: String): NetworkResult<AuthResponse> = withContext(Dispatchers.IO) {
        try {
            val jsonBody = JSONObject().apply {
                put("credential", credential)
            }
            executeRequest(
                path = "auth/google",
                method = "POST",
                body = jsonBody.toString().toRequestBody(jsonMediaType)
            ).use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful && body.isNotBlank()) {
                    val obj = JSONObject(body)

                    if (obj.optBoolean("requires_2fa", false) || obj.has("temp_token")) {
                        val tempToken = obj.optString("temp_token")
                        val emailVal = obj.optString("email")
                        val roleVal = obj.optString("role", Constants.ROLE_STAFF)
                        return@withContext NetworkResult.Success(
                            AuthResponse(
                                requires2Fa = true,
                                tempToken = tempToken,
                                email = emailVal,
                                role = roleVal
                            )
                        )
                    }

                    val token = obj.optString("access_token")
                    val csrf = obj.optString("csrf_token")
                    val accountObj = obj.optJSONObject("account")
                    val email = accountObj?.optString("email") ?: obj.optString("email")
                    val name = accountObj?.optString("name") ?: obj.optString("name", "Customer")
                    val role = accountObj?.optString("role") ?: obj.optString("role", Constants.ROLE_USER)
                    val userId = accountObj?.optLong("id") ?: obj.optLong("id", 1L)

                    val phone = accountObj?.optString("phone").takeIf { !it.isNullOrBlank() }

                    tokenManager.saveAccessToken(token)
                    if (csrf.isNotBlank()) {
                        tokenManager.saveCsrfToken(csrf)
                    }
                    tokenManager.saveUserRole(role)
                    tokenManager.saveUserEmail(email)
                    tokenManager.saveUserName(name)
                    tokenManager.saveUserPhone(phone)

                    val user = User(
                        id = userId,
                        name = name,
                        email = email,
                        phone = phone,
                        role = role
                    )
                    tokenManager.saveUserProfile(user)
                    NetworkResult.Success(AuthResponse(accessToken = token, user = user))
                } else {
                    val errorDetail = parseErrorDetail(body, "Google sign-in failed", response.code)
                    NetworkResult.Error(errorDetail, response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Google sign-in connection error")
        }
    }

    suspend fun verify2fa(tempToken: String, code: String): NetworkResult<AuthResponse> = withContext(Dispatchers.IO) {
        try {
            val jsonBody = JSONObject().apply {
                put("temp_token", tempToken)
                put("code", code)
            }
            executeRequest(
                path = "auth/verify-2fa",
                method = "POST",
                body = jsonBody.toString().toRequestBody(jsonMediaType)
            ).use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful && body.isNotBlank()) {
                    val obj = JSONObject(body)
                    val token = obj.optString("access_token")
                    val csrf = obj.optString("csrf_token")
                    val accountObj = obj.optJSONObject("account")
                    val emailVal = accountObj?.optString("email") ?: obj.optString("email")
                    val nameVal = accountObj?.optString("name") ?: obj.optString("name", "Staff Member")
                    val roleVal = accountObj?.optString("role") ?: obj.optString("role", Constants.ROLE_STAFF)
                    val userIdVal = accountObj?.optLong("id") ?: obj.optLong("id", 1L)
                    val phoneVal = accountObj?.optString("phone").takeIf { !it.isNullOrBlank() }

                    tokenManager.saveAccessToken(token)
                    if (csrf.isNotBlank()) {
                        tokenManager.saveCsrfToken(csrf)
                    }
                    tokenManager.saveUserRole(roleVal)
                    tokenManager.saveUserEmail(emailVal)
                    tokenManager.saveUserName(nameVal)
                    tokenManager.saveUserPhone(phoneVal)

                    val user = User(
                        id = userIdVal,
                        name = nameVal,
                        email = emailVal,
                        phone = phoneVal,
                        role = roleVal
                    )
                    tokenManager.saveUserProfile(user)
                    NetworkResult.Success(AuthResponse(accessToken = token, user = user))
                } else {
                    val errorDetail = parseErrorDetail(body, "2-Step verification failed", response.code)
                    NetworkResult.Error(errorDetail, response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Unable to verify 2-step security code")
        }
    }

    suspend fun register(
        name: String,
        email: String,
        phone: String?,
        password: String,
        promotionalConsent: Boolean
    ): NetworkResult<AuthResponse> = withContext(Dispatchers.IO) {
        try {
            val jsonBody = JSONObject().apply {
                put("name", name)
                put("email", email)
                put("password", password)
                if (!phone.isNullOrBlank()) put("phone", phone)
                put("promotional_consent", promotionalConsent)
            }
            executeRequest(
                path = "auth/register",
                method = "POST",
                body = jsonBody.toString().toRequestBody(jsonMediaType)
            ).use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful && body.isNotBlank()) {
                    val obj = JSONObject(body)
                    val token = obj.optString("access_token")
                    val csrf = obj.optString("csrf_token")
                    val accountObj = obj.optJSONObject("account")
                    val emailVal = accountObj?.optString("email") ?: obj.optString("email", email)
                    val nameVal = accountObj?.optString("name") ?: obj.optString("name", name)
                    val roleVal = accountObj?.optString("role") ?: obj.optString("role", Constants.ROLE_USER)
                    val userIdVal = accountObj?.optLong("id") ?: obj.optLong("id", 1L)
                    val phoneVal = accountObj?.optString("phone").takeIf { !it.isNullOrBlank() } ?: phone

                    tokenManager.saveAccessToken(token)
                    if (csrf.isNotBlank()) {
                        tokenManager.saveCsrfToken(csrf)
                    }
                    tokenManager.saveUserRole(roleVal)
                    tokenManager.saveUserEmail(emailVal)
                    tokenManager.saveUserName(nameVal)
                    tokenManager.saveUserPhone(phoneVal)

                    val user = User(
                        id = userIdVal,
                        name = nameVal,
                        email = emailVal,
                        phone = phoneVal,
                        role = roleVal,
                        promotionalConsent = promotionalConsent
                    )
                    tokenManager.saveUserProfile(user)
                    NetworkResult.Success(AuthResponse(accessToken = token, user = user))
                } else {
                    val errorDetail = parseErrorDetail(body, "Registration failed", response.code)
                    NetworkResult.Error(errorDetail, response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Unable to connect for registration")
        }
    }

    suspend fun getMyOrders(): NetworkResult<List<Order>> = withContext(Dispatchers.IO) {
        try {
            executeRequest("orders").use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful && body.isNotBlank()) {
                    val obj = JSONObject(body)
                    val itemsArray = obj.optJSONArray("items") ?: JSONArray()
                    val orders = mutableListOf<Order>()

                    for (i in 0 until itemsArray.length()) {
                        val oObj = itemsArray.getJSONObject(i)
                        val orderLines = mutableListOf<OrderItem>()
                        val linesArr = oObj.optJSONArray("items")
                        if (linesArr != null) {
                            for (j in 0 until linesArr.length()) {
                                val lObj = linesArr.getJSONObject(j)
                                orderLines.add(
                                    OrderItem(
                                        id = lObj.optLong("id"),
                                        menuItemId = lObj.optLong("menu_item_id"),
                                        name = lObj.optString("name"),
                                        variationName = lObj.optString("variation_name").takeIf { it.isNotBlank() },
                                        quantity = lObj.optInt("quantity", 1),
                                        unitPricePaise = lObj.optLong("unit_price_paise", 0L),
                                        lineTotalPaise = lObj.optLong("line_total_paise", 0L),
                                        imageUrl = resolveImageUrl(lObj.optString("image_url").takeIf { it.isNotBlank() })
                                    )
                                )
                            }
                        }

                        orders.add(
                            Order(
                                orderId = oObj.optString("order_id"),
                                customerName = oObj.optString("customer_name").takeIf { it.isNotBlank() },
                                customerPhone = oObj.optString("customer_phone").takeIf { it.isNotBlank() },
                                status = oObj.optString("status", Constants.STATUS_PLACED),
                                paymentMethod = oObj.optString("payment_method", Constants.PAYMENT_RAZORPAY),
                                paymentStatus = oObj.optString("payment_status", "PENDING"),
                                subtotalPaise = oObj.optLong("subtotal_paise", 0L),
                                deliveryFeePaise = oObj.optLong("delivery_fee_paise", 0L),
                                totalPaise = oObj.optLong("total_paise", 0L),
                                address = oObj.optString("address").takeIf { it.isNotBlank() },
                                notes = oObj.optString("notes").takeIf { it.isNotBlank() },
                                deliveryOtp = oObj.optString("delivery_otp").takeIf { it.isNotBlank() },
                                createdAt = oObj.optString("created_at").takeIf { it.isNotBlank() },
                                items = orderLines
                            )
                        )
                    }
                    NetworkResult.Success(orders)
                } else {
                    val errorDetail = parseErrorDetail(body, "Failed to fetch orders", response.code)
                    NetworkResult.Error(errorDetail, response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Failed to connect for orders")
        }
    }

    suspend fun getDeliveryEstimate(
        latitude: Double,
        longitude: Double,
        subtotalPaise: Long
    ): NetworkResult<DeliveryEstimate> = withContext(Dispatchers.IO) {
        try {
            executeRequest("restaurant/delivery-estimate?latitude=$latitude&longitude=$longitude&subtotal=$subtotalPaise").use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful && body.isNotBlank()) {
                    val json = JSONObject(body)
                    val feePaise = json.optLong("delivery_fee_paise", 0L)
                    val feeInr = json.optDouble("delivery_fee_inr", feePaise / 100.0)
                    val rawFeePaise = json.optLong("raw_delivery_fee_paise", feePaise)
                    val rawFeeInr = json.optDouble("raw_delivery_fee_inr", feeInr)
                    val roundOffPaise = json.optLong("round_off_paise", 0L)
                    val withinRadius = json.optBoolean("within_radius", true)
                    val isFreeThreshold = json.optBoolean("is_free_by_threshold", false)

                    val estimate = DeliveryEstimate(
                        distanceKm = json.optDouble("distance_km", 0.0),
                        method = json.optString("method", "HAVERSINE"),
                        deliveryFeePaise = feePaise,
                        deliveryFeeInr = feeInr,
                        rawDeliveryFeePaise = rawFeePaise,
                        rawDeliveryFeeInr = rawFeeInr,
                        roundOffPaise = roundOffPaise,
                        withinRadius = withinRadius,
                        maxRadiusKm = json.optDouble("max_radius_km", 10.0),
                        freeRadiusKm = json.optDouble("free_radius_km", 3.0),
                        freeDeliveryThresholdPaise = json.optLong("free_delivery_threshold_paise", 0L),
                        feePerKmPaise = json.optLong("fee_per_km_paise", 0L),
                        isFreeByThreshold = isFreeThreshold
                    )
                    NetworkResult.Success(estimate)
                } else {
                    NetworkResult.Error("Failed to estimate delivery fee (${response.code})", response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Unable to calculate delivery estimate")
        }
    }

    suspend fun createOrder(
        items: List<CartLine>,
        paymentMethod: String,
        address: String,
        notes: String? = null,
        scheduledFor: String? = null,
        latitude: Double? = null,
        longitude: Double? = null
    ): NetworkResult<Order> = withContext(Dispatchers.IO) {
        try {
            val linesJson = JSONArray()
            for (line in items) {
                val itemJson = JSONObject().apply {
                    put("menu_item_id", line.menuItem.id)
                    put("quantity", line.quantity)
                    if (!line.variationName.isNullOrBlank()) {
                        put("variation_name", line.variationName)
                    }
                }
                linesJson.put(itemJson)
            }

            val requestJson = JSONObject().apply {
                put("items", linesJson)
                put("payment_method", paymentMethod)
                put("address", address)
                put("notes", notes ?: "")
                if (!scheduledFor.isNullOrBlank()) {
                    put("scheduled_for", scheduledFor)
                }
                if (latitude != null && longitude != null) {
                    put("latitude", latitude)
                    put("longitude", longitude)
                }
            }

            executeRequest(
                path = "orders",
                method = "POST",
                body = requestJson.toString().toRequestBody(jsonMediaType)
            ).use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful && body.isNotBlank()) {
                    val oObj = JSONObject(body)
                    val order = Order(
                        orderId = oObj.optString("order_id"),
                        customerName = oObj.optString("customer_name").takeIf { it.isNotBlank() },
                        status = oObj.optString("status", Constants.STATUS_PLACED),
                        paymentMethod = oObj.optString("payment_method", paymentMethod),
                        paymentStatus = oObj.optString("payment_status", "PENDING"),
                        subtotalPaise = oObj.optLong("subtotal_paise", 0L),
                        deliveryFeePaise = oObj.optLong("delivery_fee_paise", 0L),
                        totalPaise = oObj.optLong("total_paise", 0L),
                        address = oObj.optString("address", address),
                        deliveryOtp = oObj.optString("delivery_otp").takeIf { it.isNotBlank() }
                    )
                    NetworkResult.Success(order)
                } else {
                    val errorDetail = parseErrorDetail(body, "Order placement failed", response.code)
                    NetworkResult.Error(errorDetail, response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Failed to submit order")
        }
    }

    suspend fun getMyProfile(): NetworkResult<User> = withContext(Dispatchers.IO) {
        try {
            executeRequest("auth/me").use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful && body.isNotBlank()) {
                    val obj = JSONObject(body)
                    val addrs = mutableListOf<Address>()
                    val addrArray = obj.optJSONArray("addresses")
                    if (addrArray != null) {
                        for (i in 0 until addrArray.length()) {
                            val aObj = addrArray.getJSONObject(i)
                            val lat = if (aObj.has("latitude") && !aObj.isNull("latitude")) aObj.optDouble("latitude") else null
                            val lng = if (aObj.has("longitude") && !aObj.isNull("longitude")) aObj.optDouble("longitude") else null
                            val idStr = when {
                                aObj.has("id") && !aObj.isNull("id") -> aObj.optString("id")
                                aObj.has("address_id") && !aObj.isNull("address_id") -> aObj.optString("address_id")
                                else -> null
                            }?.takeIf { it.isNotBlank() }
                            addrs.add(
                                Address(
                                    id = idStr,
                                    label = aObj.optString("label", "Home"),
                                    houseNumber = aObj.optString("house_number").takeIf { it.isNotBlank() },
                                    road = aObj.optString("road").takeIf { it.isNotBlank() },
                                    area = aObj.optString("area").takeIf { it.isNotBlank() },
                                    city = aObj.optString("city", "Amtala"),
                                    pincode = aObj.optString("pincode").ifBlank { aObj.optString("postal_code") }.takeIf { it.isNotBlank() },
                                    landmark = aObj.optString("landmark").takeIf { it.isNotBlank() },
                                    latitude = lat,
                                    longitude = lng,
                                    isDefault = aObj.optBoolean("is_default", false)
                                )
                            )
                        }
                    }

                    val user = User(
                        id = obj.optLong("id"),
                        name = obj.optString("name"),
                        email = obj.optString("email"),
                        phone = obj.optString("phone").takeIf { it.isNotBlank() },
                        role = obj.optString("role", Constants.ROLE_USER),
                        addresses = addrs,
                        promotionalConsent = obj.optBoolean("promotional_consent", true)
                    )
                    tokenManager.saveUserProfile(user)
                    NetworkResult.Success(user)
                } else {
                    val errorDetail = parseErrorDetail(body, "Could not retrieve profile", response.code)
                    NetworkResult.Error(errorDetail, response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Network error fetching profile")
        }
    }

    suspend fun checkEmailAvailable(email: String): NetworkResult<Boolean> = withContext(Dispatchers.IO) {
        try {
            val encodedEmail = java.net.URLEncoder.encode(email.trim().lowercase(), "UTF-8")
            executeRequest("auth/check-email?email=$encodedEmail").use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful && body.isNotBlank()) {
                    val obj = JSONObject(body)
                    NetworkResult.Success(obj.optBoolean("available", false))
                } else {
                    NetworkResult.Error("Could not verify email (${response.code})", response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Email check failed")
        }
    }

    suspend fun sendVerificationOtp(email: String, purpose: String = "REGISTER"): NetworkResult<String> = withContext(Dispatchers.IO) {
        try {
            val jsonBody = JSONObject().apply {
                put("email", email.trim().lowercase())
                put("purpose", purpose)
            }
            executeRequest(
                path = "auth/send-verification-otp",
                method = "POST",
                body = jsonBody.toString().toRequestBody(jsonMediaType)
            ).use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful) {
                    val msg = try {
                        JSONObject(body).optString("message", "Verification code sent to $email")
                    } catch (_: Exception) {
                        "Verification code sent"
                    }
                    NetworkResult.Success(msg)
                } else {
                    val errorDetail = try {
                        JSONObject(body).optString("detail", "Failed to send verification code")
                    } catch (_: Exception) {
                        "Could not send OTP (${response.code})"
                    }
                    NetworkResult.Error(errorDetail, response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Failed to connect for sending OTP")
        }
    }

    suspend fun verifyEmailOtp(email: String, otp: String, purpose: String = "REGISTER"): NetworkResult<Boolean> = withContext(Dispatchers.IO) {
        try {
            val jsonBody = JSONObject().apply {
                put("email", email.trim().lowercase())
                put("otp", otp.trim())
                put("purpose", purpose)
            }
            executeRequest(
                path = "auth/verify-email-otp",
                method = "POST",
                body = jsonBody.toString().toRequestBody(jsonMediaType)
            ).use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful) {
                    val success = try {
                        JSONObject(body).optBoolean("success", true)
                    } catch (_: Exception) {
                        true
                    }
                    NetworkResult.Success(success)
                } else {
                    val errorDetail = try {
                        JSONObject(body).optString("detail", "Invalid verification code")
                    } catch (_: Exception) {
                        "Verification failed (${response.code})"
                    }
                    NetworkResult.Error(errorDetail, response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "OTP verification connection error")
        }
    }

    suspend fun forgotPassword(email: String): NetworkResult<String> = withContext(Dispatchers.IO) {
        try {
            val jsonBody = JSONObject().apply {
                put("email", email.trim().lowercase())
            }
            executeRequest(
                path = "auth/forgot-password",
                method = "POST",
                body = jsonBody.toString().toRequestBody(jsonMediaType)
            ).use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful) {
                    val msg = try {
                        JSONObject(body).optString("message", "Password reset instructions sent to your email.")
                    } catch (_: Exception) {
                        "Password reset instructions sent."
                    }
                    NetworkResult.Success(msg)
                } else {
                    val errorDetail = try {
                        JSONObject(body).optString("detail", "Password reset request failed")
                    } catch (_: Exception) {
                        "Request failed (${response.code})"
                    }
                    NetworkResult.Error(errorDetail, response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Connection error requesting password reset")
        }
    }

    suspend fun updateProfile(
        name: String,
        email: String,
        phone: String?,
        addresses: List<Address>
    ): NetworkResult<User> = withContext(Dispatchers.IO) {
        try {
            val addrJsonArray = JSONArray()
            for (a in addresses) {
                val aObj = JSONObject().apply {
                    val addressId = when {
                        !a.id.isNullOrBlank() -> a.id
                        a.label.equals("home", ignoreCase = true) -> "home"
                        a.label.equals("work", ignoreCase = true) -> "work"
                        else -> "addr_${System.currentTimeMillis()}_${(1000..9999).random()}"
                    }
                    put("id", addressId)
                    put("label", a.label.ifBlank { "Home" })
                    put("house_number", a.houseNumber.orEmpty())
                    put("road", a.road.orEmpty())
                    put("area", a.area.orEmpty())
                    put("city", a.city.ifBlank { "Amtala" })
                    put("pincode", a.pincode.orEmpty())
                    put("landmark", a.landmark.orEmpty())
                    if (a.latitude != null) put("latitude", a.latitude)
                    if (a.longitude != null) put("longitude", a.longitude)
                    put("is_default", a.isDefault)
                }
                addrJsonArray.put(aObj)
            }

            val jsonBody = JSONObject().apply {
                put("name", name.trim())
                put("email", email.trim().lowercase())
                put("phone", phone?.trim()?.takeIf { it.isNotBlank() } ?: JSONObject.NULL)
                put("addresses", addrJsonArray)
            }

            executeRequest(
                path = "auth/profile",
                method = "PATCH",
                body = jsonBody.toString().toRequestBody(jsonMediaType)
            ).use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful && body.isNotBlank()) {
                    val obj = JSONObject(body)
                    val updatedAddresses = mutableListOf<Address>()
                    val returnedAddrs = obj.optJSONArray("addresses")
                    if (returnedAddrs != null) {
                        for (i in 0 until returnedAddrs.length()) {
                            val rObj = returnedAddrs.getJSONObject(i)
                            val lat = if (rObj.has("latitude") && !rObj.isNull("latitude")) rObj.optDouble("latitude") else null
                            val lng = if (rObj.has("longitude") && !rObj.isNull("longitude")) rObj.optDouble("longitude") else null
                            val idStr = when {
                                rObj.has("id") && !rObj.isNull("id") -> rObj.optString("id")
                                rObj.has("address_id") && !rObj.isNull("address_id") -> rObj.optString("address_id")
                                else -> null
                            }?.takeIf { it.isNotBlank() }
                            updatedAddresses.add(
                                Address(
                                    id = idStr,
                                    label = rObj.optString("label", "Home"),
                                    houseNumber = rObj.optString("house_number").takeIf { it.isNotBlank() },
                                    road = rObj.optString("road").takeIf { it.isNotBlank() },
                                    area = rObj.optString("area").takeIf { it.isNotBlank() },
                                    city = rObj.optString("city", "Amtala"),
                                    pincode = rObj.optString("pincode").ifBlank { rObj.optString("postal_code") }.takeIf { it.isNotBlank() },
                                    landmark = rObj.optString("landmark").takeIf { it.isNotBlank() },
                                    latitude = lat,
                                    longitude = lng,
                                    isDefault = rObj.optBoolean("is_default", false)
                                )
                            )
                        }
                    }

                    val updatedUser = User(
                        id = obj.optLong("id"),
                        name = obj.optString("name", name),
                        email = obj.optString("email", email),
                        phone = obj.optString("phone").takeIf { it.isNotBlank() },
                        role = obj.optString("role", Constants.ROLE_USER),
                        addresses = updatedAddresses,
                        promotionalConsent = obj.optBoolean("promotional_consent", true)
                    )
                    tokenManager.saveUserProfile(updatedUser)
                    NetworkResult.Success(updatedUser)
                } else {
                    val errorDetail = parseErrorDetail(body, "Profile update failed", response.code)
                    NetworkResult.Error(errorDetail, response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Failed to connect for profile update")
        }
    }

    suspend fun changePassword(currentPassword: String, newPassword: String): NetworkResult<Unit> = withContext(Dispatchers.IO) {
        try {
            val jsonBody = JSONObject().apply {
                put("current_password", currentPassword)
                put("new_password", newPassword)
            }
            executeRequest(
                path = "auth/change-password",
                method = "POST",
                body = jsonBody.toString().toRequestBody(jsonMediaType)
            ).use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful) {
                    NetworkResult.Success(Unit)
                } else {
                    val errorDetail = parseErrorDetail(body, "Password change failed", response.code)
                    NetworkResult.Error(errorDetail, response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Failed to connect for password change")
        }
    }

    // --- Security & Active Sessions ---

    suspend fun getUserSessions(): NetworkResult<List<UserSession>> = withContext(Dispatchers.IO) {
        try {
            executeRequest(path = "auth/sessions", method = "GET").use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful) {
                    val array = JSONArray(body)
                    val sessions = mutableListOf<UserSession>()
                    for (i in 0 until array.length()) {
                        val obj = array.getJSONObject(i)
                        sessions.add(
                            UserSession(
                                id = obj.optString("id"),
                                userAgent = obj.optString("user_agent").takeIf { it.isNotBlank() },
                                ipAddress = obj.optString("ip_address").takeIf { it.isNotBlank() },
                                deviceType = obj.optString("device_type", "mobile"),
                                isCurrent = obj.optBoolean("is_current", false),
                                lastActive = obj.optString("last_active_at").takeIf { it.isNotBlank() } ?: obj.optString("created_at"),
                                createdAt = obj.optString("created_at")
                            )
                        )
                    }
                    NetworkResult.Success(sessions)
                } else {
                    val errorDetail = parseErrorDetail(body, "Failed to load active sessions", response.code)
                    NetworkResult.Error(errorDetail, response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Failed to connect to load sessions")
        }
    }

    suspend fun revokeSession(sessionId: String): NetworkResult<Boolean> = withContext(Dispatchers.IO) {
        try {
            executeRequest(path = "auth/sessions/$sessionId/revoke", method = "POST").use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful) {
                    val obj = if (body.isNotBlank()) JSONObject(body) else JSONObject()
                    val isCurrent = obj.optBoolean("is_current", false)
                    NetworkResult.Success(isCurrent)
                } else {
                    val errorDetail = parseErrorDetail(body, "Failed to revoke session", response.code)
                    NetworkResult.Error(errorDetail, response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Failed to connect to revoke session")
        }
    }

    suspend fun revokeOtherSessions(): NetworkResult<Unit> = withContext(Dispatchers.IO) {
        try {
            executeRequest(path = "auth/sessions/revoke-others", method = "POST").use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful) {
                    NetworkResult.Success(Unit)
                } else {
                    val errorDetail = parseErrorDetail(body, "Failed to revoke other sessions", response.code)
                    NetworkResult.Error(errorDetail, response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Failed to connect to revoke other sessions")
        }
    }

    // --- Admin & Workspace Endpoints ---

    suspend fun getSalesReport(period: String = "today"): NetworkResult<SalesReport> = withContext(Dispatchers.IO) {
        try {
            executeRequest(path = "admin/reports/sales?period=$period", method = "GET").use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful) {
                    val obj = JSONObject(body)
                    val statusMap = mutableMapOf<String, Int>()
                    val statusesObj = obj.optJSONObject("statuses")
                    if (statusesObj != null) {
                        for (key in statusesObj.keys()) {
                            statusMap[key] = statusesObj.optInt(key, 0)
                        }
                    }
                    val topItemsList = mutableListOf<TopItem>()
                    val topArray = obj.optJSONArray("top_items")
                    if (topArray != null) {
                        for (i in 0 until topArray.length()) {
                            val itemObj = topArray.getJSONObject(i)
                            topItemsList.add(
                                TopItem(
                                    name = itemObj.optString("name", "Item"),
                                    quantity = itemObj.optInt("quantity", 0)
                                )
                            )
                        }
                    }

                    var cashOrders = 0
                    var cashRev = 0L
                    var onlineOrders = 0
                    var onlineRev = 0L
                    val payObj = obj.optJSONObject("payment_methods")
                    if (payObj != null) {
                        val cash = payObj.optJSONObject("cash")
                        if (cash != null) {
                            cashOrders = cash.optInt("orders", 0)
                            cashRev = cash.optLong("revenue_paise", 0L)
                        }
                        val online = payObj.optJSONObject("online")
                        if (online != null) {
                            onlineOrders = online.optInt("orders", 0)
                            onlineRev = online.optLong("revenue_paise", 0L)
                        }
                    }

                    val orderTypesObj = obj.optJSONObject("order_types")
                    var deliveryOrders = 0
                    var deliveryRev = 0L
                    var dineInOrders = 0
                    var dineInRev = 0L
                    if (orderTypesObj != null) {
                        val deliv = orderTypesObj.optJSONObject("delivery")
                        if (deliv != null) {
                            deliveryOrders = deliv.optInt("orders", 0)
                            deliveryRev = deliv.optLong("revenue_paise", 0L)
                        }
                        val dineIn = orderTypesObj.optJSONObject("dine_in")
                        if (dineIn != null) {
                            dineInOrders = dineIn.optInt("orders", 0)
                            dineInRev = dineIn.optLong("revenue_paise", 0L)
                        }
                    }

                    val seriesList = mutableListOf<SalesChartPoint>()
                    val seriesArray = obj.optJSONArray("series")
                    if (seriesArray != null) {
                        for (i in 0 until seriesArray.length()) {
                            val p = seriesArray.getJSONObject(i)
                            seriesList.add(
                                SalesChartPoint(
                                    label = p.optString("label", ""),
                                    revenuePaise = p.optLong("revenue_paise", 0L),
                                    orders = p.optInt("orders", 0)
                                )
                            )
                        }
                    }

                    val report = SalesReport(
                        period = obj.optString("period", period),
                        revenuePaise = obj.optLong("revenue_paise", 0L),
                        paidOrders = obj.optInt("paid_orders", 0),
                        totalOrders = obj.optInt("total_orders", 0),
                        averageOrderPaise = obj.optLong("average_order_paise", 0L),
                        statuses = statusMap,
                        topItems = topItemsList,
                        series = seriesList,
                        cashOrders = cashOrders,
                        cashRevenuePaise = cashRev,
                        onlineOrders = onlineOrders,
                        onlineRevenuePaise = onlineRev,
                        deliveryOrders = deliveryOrders,
                        deliveryRevenuePaise = deliveryRev,
                        dineInOrders = dineInOrders,
                        dineInRevenuePaise = dineInRev
                    )
                    NetworkResult.Success(report)
                } else {
                    val errorDetail = parseErrorDetail(body, "Failed to load sales report", response.code)
                    NetworkResult.Error(errorDetail, response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Failed to connect for sales report")
        }
    }

    suspend fun getAdminAccounts(excludeUsers: Boolean = true): NetworkResult<List<AdminAccount>> = withContext(Dispatchers.IO) {
        try {
            executeRequest(path = "admin/accounts?exclude_users=$excludeUsers&limit=100", method = "GET").use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful) {
                    val obj = JSONObject(body)
                    val itemsArray = obj.optJSONArray("items") ?: JSONArray()
                    val accounts = mutableListOf<AdminAccount>()
                    for (i in 0 until itemsArray.length()) {
                        val accObj = itemsArray.getJSONObject(i)
                        accounts.add(
                            AdminAccount(
                                id = accObj.optLong("id"),
                                name = accObj.optString("name", "Staff Member"),
                                email = accObj.optString("email"),
                                phone = accObj.optString("phone").takeIf { it.isNotBlank() },
                                role = accObj.optString("role", "STAFF"),
                                createdAt = accObj.optString("created_at")
                            )
                        )
                    }
                    NetworkResult.Success(accounts)
                } else {
                    val errorDetail = parseErrorDetail(body, "Failed to load team members", response.code)
                    NetworkResult.Error(errorDetail, response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Failed to connect for accounts")
        }
    }

    suspend fun getAdminAccountsSummary(limit: Int = 5): NetworkResult<AdminAccountsSummary> = withContext(Dispatchers.IO) {
        try {
            executeRequest(path = "admin/accounts?limit=$limit", method = "GET").use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful) {
                    val obj = JSONObject(body)
                    val itemsArray = obj.optJSONArray("items") ?: JSONArray()
                    val accounts = mutableListOf<AdminAccount>()
                    for (i in 0 until itemsArray.length()) {
                        val accObj = itemsArray.getJSONObject(i)
                        accounts.add(
                            AdminAccount(
                                id = accObj.optLong("id"),
                                name = accObj.optString("name", "Staff Member"),
                                email = accObj.optString("email"),
                                phone = accObj.optString("phone").takeIf { it.isNotBlank() },
                                role = accObj.optString("role", "STAFF"),
                                createdAt = accObj.optString("created_at")
                            )
                        )
                    }
                    val roleCountsMap = mutableMapOf<String, Int>()
                    val rcObj = obj.optJSONObject("role_counts")
                    if (rcObj != null) {
                        for (k in rcObj.keys()) {
                            roleCountsMap[k] = rcObj.optInt(k, 0)
                        }
                    }
                    NetworkResult.Success(
                        AdminAccountsSummary(
                            items = accounts,
                            total = obj.optInt("total", accounts.size),
                            roleCounts = roleCountsMap
                        )
                    )
                } else {
                    val errorDetail = parseErrorDetail(body, "Failed to load accounts summary", response.code)
                    NetworkResult.Error(errorDetail, response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Failed to connect for accounts summary")
        }
    }

    suspend fun createAdminAccount(name: String, email: String, phone: String, role: String, password: String): NetworkResult<AdminAccount> = withContext(Dispatchers.IO) {
        try {
            val jsonBody = JSONObject().apply {
                put("name", name)
                put("email", email)
                put("phone", phone)
                put("role", role)
                put("password", password)
            }
            executeRequest(
                path = "admin/accounts",
                method = "POST",
                body = jsonBody.toString().toRequestBody(jsonMediaType)
            ).use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful) {
                    val accObj = JSONObject(body)
                    val acc = AdminAccount(
                        id = accObj.optLong("id", System.currentTimeMillis()),
                        name = accObj.optString("name", name),
                        email = accObj.optString("email", email),
                        phone = accObj.optString("phone", phone),
                        role = accObj.optString("role", role),
                        createdAt = accObj.optString("created_at")
                    )
                    NetworkResult.Success(acc)
                } else {
                    val errorDetail = parseErrorDetail(body, "Failed to create team member", response.code)
                    NetworkResult.Error(errorDetail, response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Failed to connect to create account")
        }
    }

    suspend fun getAdminOrders(status: String? = null, query: String? = null, limit: Int = 50): NetworkResult<AdminOrdersResponse> = withContext(Dispatchers.IO) {
        try {
            var url = "admin/orders?limit=$limit"
            if (!status.isNullOrBlank() && status != "ALL") {
                url += "&status=$status"
            }
            if (!query.isNullOrBlank()) {
                url += "&q=$query"
            }
            executeRequest(path = url, method = "GET").use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful) {
                    val obj = JSONObject(body)
                    val ordersArray = obj.optJSONArray("items") ?: JSONArray()
                    val ordersList = mutableListOf<Order>()
                    for (i in 0 until ordersArray.length()) {
                        val o = ordersArray.getJSONObject(i)
                        ordersList.add(parseOrderJson(o))
                    }
                    NetworkResult.Success(AdminOrdersResponse(ordersList, obj.optInt("total", ordersList.size)))
                } else {
                    val errorDetail = parseErrorDetail(body, "Failed to load master orders", response.code)
                    NetworkResult.Error(errorDetail, response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Failed to connect for admin orders")
        }
    }

    suspend fun getAdminOrdersSummary(limit: Int = 5): NetworkResult<AdminOrdersSummary> = withContext(Dispatchers.IO) {
        try {
            executeRequest(path = "admin/orders?limit=$limit", method = "GET").use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful) {
                    val obj = JSONObject(body)
                    val ordersArray = obj.optJSONArray("items") ?: JSONArray()
                    val ordersList = mutableListOf<Order>()
                    for (i in 0 until ordersArray.length()) {
                        ordersList.add(parseOrderJson(ordersArray.getJSONObject(i)))
                    }
                    val statusCountsMap = mutableMapOf<String, Int>()
                    val scObj = obj.optJSONObject("status_counts")
                    if (scObj != null) {
                        for (k in scObj.keys()) {
                            statusCountsMap[k] = scObj.optInt(k, 0)
                        }
                    }
                    NetworkResult.Success(
                        AdminOrdersSummary(
                            items = ordersList,
                            total = obj.optInt("total", ordersList.size),
                            statusCounts = statusCountsMap
                        )
                    )
                } else {
                    val errorDetail = parseErrorDetail(body, "Failed to load orders summary", response.code)
                    NetworkResult.Error(errorDetail, response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Failed to connect for orders summary")
        }
    }

    suspend fun updateAdminOrderStatus(orderId: String, status: String): NetworkResult<Unit> = withContext(Dispatchers.IO) {
        try {
            val jsonBody = JSONObject().apply { put("status", status) }
            executeRequest(
                path = "admin/orders/$orderId/status",
                method = "PATCH",
                body = jsonBody.toString().toRequestBody(jsonMediaType)
            ).use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful) {
                    NetworkResult.Success(Unit)
                } else {
                    val errorDetail = parseErrorDetail(body, "Failed to update order status", response.code)
                    NetworkResult.Error(errorDetail, response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Failed to connect to update order")
        }
    }

    suspend fun refundAdminOrder(orderId: String, reason: String = "Admin cancelled"): NetworkResult<Unit> = withContext(Dispatchers.IO) {
        try {
            val jsonBody = JSONObject().apply { put("reason", reason) }
            executeRequest(
                path = "admin/orders/$orderId/refund",
                method = "POST",
                body = jsonBody.toString().toRequestBody(jsonMediaType)
            ).use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful) {
                    NetworkResult.Success(Unit)
                } else {
                    val errorDetail = parseErrorDetail(body, "Failed to issue refund", response.code)
                    NetworkResult.Error(errorDetail, response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Failed to connect to refund order")
        }
    }

    suspend fun getStaffOrders(): NetworkResult<List<Order>> = withContext(Dispatchers.IO) {
        try {
            executeRequest(path = "staff/orders", method = "GET").use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful) {
                    val array = JSONArray(body)
                    val list = mutableListOf<Order>()
                    for (i in 0 until array.length()) {
                        list.add(parseOrderJson(array.getJSONObject(i)))
                    }
                    NetworkResult.Success(list)
                } else {
                    val errorDetail = parseErrorDetail(body, "Failed to load kitchen queue", response.code)
                    NetworkResult.Error(errorDetail, response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Failed to connect for kitchen queue")
        }
    }

    suspend fun updateStaffOrderStatus(orderId: String, status: String): NetworkResult<Unit> = withContext(Dispatchers.IO) {
        try {
            val jsonBody = JSONObject().apply { put("status", status) }
            executeRequest(
                path = "staff/orders/$orderId/status",
                method = "PATCH",
                body = jsonBody.toString().toRequestBody(jsonMediaType)
            ).use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful) {
                    NetworkResult.Success(Unit)
                } else {
                    val errorDetail = parseErrorDetail(body, "Failed to update kitchen order status", response.code)
                    NetworkResult.Error(errorDetail, response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Failed to connect to update order")
        }
    }

    suspend fun getMenuPauses(): NetworkResult<List<MenuPauseItem>> = withContext(Dispatchers.IO) {
        try {
            executeRequest(path = "staff/menu-pauses", method = "GET").use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful) {
                    val array = JSONArray(body)
                    val list = mutableListOf<MenuPauseItem>()
                    for (i in 0 until array.length()) {
                        val obj = array.getJSONObject(i)
                        list.add(
                            MenuPauseItem(
                                menuItemId = obj.optString("menu_item_id"),
                                employeeName = obj.optString("employee_name", "Staff"),
                                pausedUntil = obj.optString("paused_until")
                            )
                        )
                    }
                    NetworkResult.Success(list)
                } else {
                    val errorDetail = parseErrorDetail(body, "Failed to load paused items", response.code)
                    NetworkResult.Error(errorDetail, response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Failed to connect for menu pauses")
        }
    }

    suspend fun toggleMenuPause(menuItemId: String, isPaused: Boolean, mode: String = "today"): NetworkResult<Unit> = withContext(Dispatchers.IO) {
        try {
            val isCustom = menuItemId.startsWith("custom-")
            val cleanId = menuItemId.removePrefix("custom-")
            val path = if (isCustom) "staff/custom-menu/$cleanId/pause" else "staff/menu/$cleanId/pause"
            val method = if (isPaused) "POST" else "DELETE"
            val body = if (isPaused) {
                JSONObject().apply { put("mode", mode) }.toString().toRequestBody(jsonMediaType)
            } else null

            executeRequest(
                path = path,
                method = method,
                body = body
            ).use { response ->
                val resBody = response.body?.string() ?: ""
                if (response.isSuccessful) {
                    NetworkResult.Success(Unit)
                } else {
                    val errorDetail = parseErrorDetail(resBody, "Failed to toggle item availability", response.code)
                    NetworkResult.Error(errorDetail, response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Failed to connect for item pause toggle")
        }
    }

    suspend fun getAdminEvents(limit: Int = 50): NetworkResult<List<AdminEvent>> = withContext(Dispatchers.IO) {
        try {
            executeRequest(path = "admin/events?limit=$limit", method = "GET").use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful) {
                    val array = if (body.trim().startsWith("[")) {
                        JSONArray(body)
                    } else {
                        JSONObject(body).optJSONArray("items") ?: JSONArray()
                    }
                    val list = mutableListOf<AdminEvent>()
                    for (i in 0 until array.length()) {
                        val obj = array.getJSONObject(i)
                        list.add(
                            AdminEvent(
                                id = obj.optLong("id"),
                                eventType = obj.optString("event_type", "AUDIT"),
                                description = obj.optString("message", obj.optString("description", obj.optString("details", "Activity recorded"))),
                                actorEmail = obj.optString("actor_email").takeIf { it.isNotBlank() },
                                actorName = obj.optString("actor_name", obj.optString("actor_email")).takeIf { it.isNotBlank() },
                                createdAt = obj.optString("created_at")
                            )
                        )
                    }
                    NetworkResult.Success(list)
                } else {
                    val errorDetail = parseErrorDetail(body, "Failed to load audit events", response.code)
                    NetworkResult.Error(errorDetail, response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Failed to connect for audit events")
        }
    }

    suspend fun getDiscounts(): NetworkResult<List<MenuDiscount>> = withContext(Dispatchers.IO) {
        try {
            executeRequest(path = "admin/discounts", method = "GET").use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful) {
                    val array = JSONArray(body)
                    val list = mutableListOf<MenuDiscount>()
                    for (i in 0 until array.length()) {
                        val obj = array.getJSONObject(i)
                        val pct = if (obj.has("percentage") && !obj.isNull("percentage")) obj.optDouble("percentage") else null
                        val flat = if (obj.has("flat_amount_paise") && !obj.isNull("flat_amount_paise")) obj.optLong("flat_amount_paise") else null
                        list.add(
                            MenuDiscount(
                                id = obj.optLong("id"),
                                code = obj.optString("code", "DISCOUNT"),
                                percentage = pct,
                                flatAmountPaise = flat,
                                minOrderPaise = obj.optLong("min_order_paise", 0L),
                                isActive = obj.optBoolean("is_active", true)
                            )
                        )
                    }
                    NetworkResult.Success(list)
                } else {
                    val errorDetail = parseErrorDetail(body, "Failed to load discounts", response.code)
                    NetworkResult.Error(errorDetail, response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Failed to connect for discounts")
        }
    }

    suspend fun createDiscount(code: String, percentage: Double?, flatAmountPaise: Long?, minOrderPaise: Long): NetworkResult<MenuDiscount> = withContext(Dispatchers.IO) {
        try {
            val jsonBody = JSONObject().apply {
                put("code", code.trim().uppercase())
                if (percentage != null && percentage > 0) put("percentage", percentage)
                if (flatAmountPaise != null && flatAmountPaise > 0) put("flat_amount_paise", flatAmountPaise)
                put("min_order_paise", minOrderPaise)
                put("is_active", true)
            }
            executeRequest(
                path = "admin/discounts",
                method = "POST",
                body = jsonBody.toString().toRequestBody(jsonMediaType)
            ).use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful) {
                    val obj = JSONObject(body)
                    val d = MenuDiscount(
                        id = obj.optLong("id", System.currentTimeMillis()),
                        code = obj.optString("code", code),
                        percentage = percentage,
                        flatAmountPaise = flatAmountPaise,
                        minOrderPaise = minOrderPaise,
                        isActive = true
                    )
                    NetworkResult.Success(d)
                } else {
                    val errorDetail = parseErrorDetail(body, "Failed to create discount", response.code)
                    NetworkResult.Error(errorDetail, response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Failed to connect to create discount")
        }
    }

    suspend fun deleteDiscount(discountId: Long): NetworkResult<Unit> = withContext(Dispatchers.IO) {
        try {
            executeRequest(path = "admin/discounts/$discountId", method = "DELETE").use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful) {
                    NetworkResult.Success(Unit)
                } else {
                    val errorDetail = parseErrorDetail(body, "Failed to delete discount", response.code)
                    NetworkResult.Error(errorDetail, response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Failed to connect to delete discount")
        }
    }

    suspend fun sendOfferBroadcast(
        subject: String,
        message: String,
        audience: String = "ALL",
        channels: List<String> = listOf("EMAIL"),
        headline: String? = null,
        subheading: String? = null,
        promoCode: String? = null,
        discountHighlight: String? = null,
        ctaText: String? = null,
        ctaUrl: String? = null
    ): NetworkResult<Unit> = withContext(Dispatchers.IO) {
        try {
            val jsonBody = JSONObject().apply {
                put("audience", audience)
                val chanArr = JSONArray()
                channels.forEach { chanArr.put(it) }
                put("channels", chanArr)
                put("subject", subject)
                put("message", message)
                if (!headline.isNullOrBlank()) put("headline", headline)
                if (!subheading.isNullOrBlank()) put("subheading", subheading)
                if (!promoCode.isNullOrBlank()) put("promo_code", promoCode)
                if (!discountHighlight.isNullOrBlank()) put("discount_highlight", discountHighlight)
                if (!ctaText.isNullOrBlank()) put("cta_text", ctaText)
                if (!ctaUrl.isNullOrBlank()) put("cta_url", ctaUrl)
            }
            executeRequest(
                path = "admin/offers",
                method = "POST",
                body = jsonBody.toString().toRequestBody(jsonMediaType)
            ).use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful) {
                    NetworkResult.Success(Unit)
                } else {
                    val errorDetail = parseErrorDetail(body, "Failed to send broadcast", response.code)
                    NetworkResult.Error(errorDetail, response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Failed to connect for broadcast")
        }
    }

    suspend fun getOfferLogs(): NetworkResult<List<OfferLog>> = withContext(Dispatchers.IO) {
        try {
            executeRequest(path = "admin/offers", method = "GET").use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful) {
                    val array = JSONArray(body)
                    val list = mutableListOf<OfferLog>()
                    for (i in 0 until array.length()) {
                        val obj = array.getJSONObject(i)
                        val subject = obj.optString("subject", obj.optString("title", "Broadcast Alert"))
                        val channelsList = mutableListOf<String>()
                        val chanArr = obj.optJSONArray("channels")
                        if (chanArr != null) {
                            for (c in 0 until chanArr.length()) {
                                channelsList.add(chanArr.optString(c))
                            }
                        }
                        list.add(
                            OfferLog(
                                id = obj.optLong("id"),
                                subject = subject,
                                message = obj.optString("message", ""),
                                audience = obj.optString("audience", "ALL"),
                                channels = if (channelsList.isNotEmpty()) channelsList else listOf("EMAIL"),
                                recipientCount = obj.optInt("recipient_count", 0),
                                sentCount = obj.optInt("sent_count", 0),
                                status = obj.optString("status", "QUEUED"),
                                createdAt = obj.optString("created_at")
                            )
                        )
                    }
                    NetworkResult.Success(list)
                } else {
                    val errorDetail = parseErrorDetail(body, "Failed to load broadcast logs", response.code)
                    NetworkResult.Error(errorDetail, response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Failed to connect for broadcast logs")
        }
    }

    suspend fun updateDiscountActive(discountId: Long, isActive: Boolean): NetworkResult<Unit> = withContext(Dispatchers.IO) {
        try {
            val jsonBody = JSONObject().apply {
                put("is_active", isActive)
            }
            executeRequest(
                path = "admin/discounts/$discountId",
                method = "PUT",
                body = jsonBody.toString().toRequestBody(jsonMediaType)
            ).use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful) {
                    NetworkResult.Success(Unit)
                } else {
                    val errorDetail = parseErrorDetail(body, "Failed to update coupon status", response.code)
                    NetworkResult.Error(errorDetail, response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Failed to connect for discount update")
        }
    }

    suspend fun getAdminSettings(): NetworkResult<AdminRestaurantSettings> = withContext(Dispatchers.IO) {
        try {
            executeRequest(path = "admin/settings", method = "GET").use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful) {
                    val obj = JSONObject(body)
                    val settings = AdminRestaurantSettings(
                        isOpen = obj.optBoolean("is_open", obj.optBoolean("accepting_orders", true)),
                        isDeliveryEnabled = obj.optBoolean("is_delivery_enabled", obj.optBoolean("is_delivery_open", true)),
                        restaurantName = obj.optString("restaurant_name", "KebabZilla"),
                        tagline = obj.optString("tagline", "Smoky Kebabs & Rolls"),
                        address = obj.optString("address", "Kolkata, India"),
                        openTime = obj.optString("open_time", "11:00"),
                        closeTime = obj.optString("close_time", "23:00"),
                        phone = obj.optString("phone", "+91 9876543210"),
                        deliveryRadiusKm = obj.optDouble("delivery_radius_km", 15.0),
                        freeDeliveryRadiusKm = obj.optDouble("free_delivery_radius_km", 2.0),
                        freeDeliveryThresholdPaise = obj.optLong("free_delivery_threshold_paise", 29900L),
                        deliveryFeePerKmPaise = obj.optLong("delivery_fee_per_km_paise", 1500L),
                        minimumOrderPaise = obj.optLong("minimum_order_paise", 0L),
                        orderCutoffMinutes = obj.optInt("order_cutoff_minutes_before_closing", 30),
                        availableDriversReady = obj.optInt("available_drivers_ready", 0)
                    )
                    NetworkResult.Success(settings)
                } else {
                    val errorDetail = parseErrorDetail(body, "Failed to load restaurant settings", response.code)
                    NetworkResult.Error(errorDetail, response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Failed to connect for settings")
        }
    }

    suspend fun updateAdminSettings(settings: AdminRestaurantSettings): NetworkResult<Unit> = withContext(Dispatchers.IO) {
        try {
            val jsonBody = JSONObject().apply {
                put("restaurant_name", settings.restaurantName)
                put("tagline", settings.tagline)
                put("phone", settings.phone)
                put("address", settings.address)
                put("delivery_radius_km", settings.deliveryRadiusKm)
                put("free_delivery_radius_km", settings.freeDeliveryRadiusKm)
                put("free_delivery_threshold_paise", settings.freeDeliveryThresholdPaise)
                put("delivery_fee_per_km_paise", settings.deliveryFeePerKmPaise)
                put("minimum_order_paise", settings.minimumOrderPaise)
                put("accepting_orders", settings.isOpen)
                put("is_delivery_open", settings.isDeliveryEnabled)
                put("order_cutoff_minutes_before_closing", settings.orderCutoffMinutes)
            }
            executeRequest(
                path = "admin/settings",
                method = "PUT",
                body = jsonBody.toString().toRequestBody(jsonMediaType)
            ).use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful) {
                    NetworkResult.Success(Unit)
                } else {
                    val errorDetail = parseErrorDetail(body, "Failed to update restaurant settings", response.code)
                    NetworkResult.Error(errorDetail, response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Failed to connect to save settings")
        }
    }

    suspend fun createWalkInOrder(
        customerName: String,
        phone: String?,
        items: List<CartLine>
    ): NetworkResult<Order> = withContext(Dispatchers.IO) {
        try {
            val queryParams = StringBuilder("customer_name=").append(java.net.URLEncoder.encode(customerName, "UTF-8"))
            if (!phone.isNullOrBlank()) {
                val cleanPhone = if (phone.startsWith("+91")) phone else "+91$phone"
                queryParams.append("&phone=").append(java.net.URLEncoder.encode(cleanPhone, "UTF-8"))
            }

            val itemsArray = JSONArray()
            for (line in items) {
                val itemObj = JSONObject().apply {
                    put("menu_item_id", line.menuItem.id)
                    put("quantity", line.quantity)
                    if (!line.variationName.isNullOrBlank()) {
                        put("variation_name", line.variationName)
                    }
                }
                itemsArray.put(itemObj)
            }

            val jsonBody = JSONObject().apply {
                put("items", itemsArray)
                put("payment_method", "CASH")
                put("address", "Restaurant counter")
                put("notes", "")
            }

            executeRequest(
                path = "staff/walk-in?$queryParams",
                method = "POST",
                body = jsonBody.toString().toRequestBody(jsonMediaType)
            ).use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful) {
                    val obj = JSONObject(body)
                    NetworkResult.Success(parseOrderJson(obj))
                } else {
                    val errorDetail = parseErrorDetail(body, "Failed to create walk-in bill", response.code)
                    NetworkResult.Error(errorDetail, response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Failed to connect for walk-in order")
        }
    }

    suspend fun createMenuItem(
        name: String,
        description: String,
        category: String,
        pricePaise: Long,
        isVeg: Boolean,
        variations: List<Pair<String, Long>> = emptyList()
    ): NetworkResult<MenuItem> = withContext(Dispatchers.IO) {
        try {
            val varArray = JSONArray()
            for ((varName, varPrice) in variations) {
                varArray.put(JSONObject().apply {
                    put("name", varName)
                    put("price_paise", varPrice)
                })
            }
            val jsonBody = JSONObject().apply {
                put("name", name)
                put("description", description)
                put("category", category)
                put("categories", JSONArray().apply { put(category) })
                put("price_paise", pricePaise)
                put("is_vegetarian", isVeg)
                put("is_available", true)
                put("variations", varArray)
            }
            executeRequest(
                path = "menu",
                method = "POST",
                body = jsonBody.toString().toRequestBody(jsonMediaType)
            ).use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful) {
                    val obj = JSONObject(body)
                    NetworkResult.Success(
                        MenuItem(
                            id = obj.optLong("id", System.currentTimeMillis()),
                            name = obj.optString("name", name),
                            description = obj.optString("description", description),
                            category = obj.optString("category", category),
                            pricePaise = obj.optLong("price_paise", pricePaise),
                            isVegetarian = obj.optBoolean("is_vegetarian", isVeg),
                            isAvailable = obj.optBoolean("is_available", true)
                        )
                    )
                } else {
                    val errorDetail = parseErrorDetail(body, "Failed to create menu item", response.code)
                    NetworkResult.Error(errorDetail, response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Failed to connect to create menu item")
        }
    }

    suspend fun deleteMenuItem(itemId: Long): NetworkResult<Unit> = withContext(Dispatchers.IO) {
        try {
            executeRequest(path = "menu/$itemId", method = "DELETE").use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful) {
                    NetworkResult.Success(Unit)
                } else {
                    val errorDetail = parseErrorDetail(body, "Failed to delete menu item", response.code)
                    NetworkResult.Error(errorDetail, response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Failed to connect to delete menu item")
        }
    }

    suspend fun unassignDelivery(orderId: String): NetworkResult<Unit> = withContext(Dispatchers.IO) {
        try {
            executeRequest(path = "admin/orders/$orderId/unassign-delivery", method = "POST").use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful) {
                    NetworkResult.Success(Unit)
                } else {
                    val errorDetail = parseErrorDetail(body, "Failed to unassign delivery", response.code)
                    NetworkResult.Error(errorDetail, response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Failed to connect to unassign delivery")
        }
    }

    suspend fun updateStaffAccountRole(accountId: Long, newRole: String, adminPassword: String): NetworkResult<Unit> = withContext(Dispatchers.IO) {
        try {
            val jsonBody = JSONObject().apply {
                put("role", newRole)
                put("password", adminPassword)
            }
            executeRequest(
                path = "admin/accounts/$accountId/role",
                method = "PATCH",
                body = jsonBody.toString().toRequestBody(jsonMediaType)
            ).use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful) {
                    NetworkResult.Success(Unit)
                } else {
                    val errorDetail = parseErrorDetail(body, "Failed to update staff role", response.code)
                    NetworkResult.Error(errorDetail, response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Failed to connect to update role")
        }
    }

    suspend fun getAccountOrders(accountId: Long): NetworkResult<List<Order>> = withContext(Dispatchers.IO) {
        try {
            executeRequest(path = "admin/accounts/$accountId/orders", method = "GET").use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful) {
                    val array = JSONArray(body)
                    val list = mutableListOf<Order>()
                    for (i in 0 until array.length()) {
                        list.add(parseOrderJson(array.getJSONObject(i)))
                    }
                    NetworkResult.Success(list)
                } else {
                    val errorDetail = parseErrorDetail(body, "Failed to load account orders", response.code)
                    NetworkResult.Error(errorDetail, response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Failed to connect for account orders")
        }
    }

    suspend fun getDriverDutyStatus(): NetworkResult<DriverDutyStatus> = withContext(Dispatchers.IO) {
        try {
            executeRequest(path = "delivery/duty-status", method = "GET").use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful && body.isNotBlank()) {
                    val obj = JSONObject(body)
                    NetworkResult.Success(
                        DriverDutyStatus(
                            isAcceptingDeliveries = obj.optBoolean("is_accepting_deliveries", false),
                            isRestaurantOpen = obj.optBoolean("is_restaurant_open", true),
                            scheduleStatus = obj.optString("schedule_status").takeIf { it.isNotBlank() },
                            activeRiders = obj.optInt("active_riders", 0),
                            restaurantLatitude = if (obj.has("restaurant_latitude") && !obj.isNull("restaurant_latitude")) obj.optDouble("restaurant_latitude") else null,
                            restaurantLongitude = if (obj.has("restaurant_longitude") && !obj.isNull("restaurant_longitude")) obj.optDouble("restaurant_longitude") else null
                        )
                    )
                } else {
                    val errorDetail = parseErrorDetail(body, "Failed to load duty status", response.code)
                    NetworkResult.Error(errorDetail, response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Failed to connect to duty status")
        }
    }

    suspend fun updateDriverDutyStatus(accepting: Boolean, lat: Double? = null, lng: Double? = null): NetworkResult<DriverDutyStatus> = withContext(Dispatchers.IO) {
        try {
            val jsonBody = JSONObject().apply {
                put("accepting", accepting)
                if (lat != null && lng != null) {
                    put("latitude", lat)
                    put("longitude", lng)
                }
            }
            executeRequest(
                path = "delivery/duty-status",
                method = "POST",
                body = jsonBody.toString().toRequestBody(jsonMediaType)
            ).use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful && body.isNotBlank()) {
                    val obj = JSONObject(body)
                    NetworkResult.Success(
                        DriverDutyStatus(
                            isAcceptingDeliveries = obj.optBoolean("is_accepting_deliveries", false),
                            isRestaurantOpen = obj.optBoolean("is_restaurant_open", true),
                            scheduleStatus = obj.optString("schedule_status").takeIf { it.isNotBlank() },
                            activeRiders = obj.optInt("active_riders", 0)
                        )
                    )
                } else {
                    val errorDetail = parseErrorDetail(body, "Failed to update duty status", response.code)
                    NetworkResult.Error(errorDetail, response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Failed to connect to update duty status")
        }
    }

    suspend fun getDeliveryHistory(): NetworkResult<List<Order>> = withContext(Dispatchers.IO) {
        try {
            executeRequest(path = "delivery/history", method = "GET").use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful) {
                    val array = JSONArray(body)
                    val list = mutableListOf<Order>()
                    for (i in 0 until array.length()) {
                        list.add(parseOrderJson(array.getJSONObject(i)))
                    }
                    NetworkResult.Success(list)
                } else {
                    val errorDetail = parseErrorDetail(body, "Failed to load delivery history", response.code)
                    NetworkResult.Error(errorDetail, response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Failed to connect to delivery history")
        }
    }

    suspend fun verifyDeliveryOtp(orderId: String, otp: String): NetworkResult<Boolean> = withContext(Dispatchers.IO) {
        try {
            val jsonBody = JSONObject().apply {
                put("otp", otp.trim())
            }
            executeRequest(
                path = "delivery/orders/$orderId/verify-otp",
                method = "POST",
                body = jsonBody.toString().toRequestBody(jsonMediaType)
            ).use { response ->
                val body = response.body?.string() ?: ""
                if (response.isSuccessful) {
                    NetworkResult.Success(true)
                } else {
                    val errorDetail = parseErrorDetail(body, "Invalid delivery OTP", response.code)
                    NetworkResult.Error(errorDetail, response.code)
                }
            }
        } catch (e: Exception) {
            NetworkResult.Error(e.localizedMessage ?: "Failed to connect to verify delivery OTP")
        }
    }

    private fun parseOrderJson(o: JSONObject): Order {
        val itemsArray = o.optJSONArray("items") ?: JSONArray()
        val itemsList = mutableListOf<com.kebabzilla.data.model.OrderItem>()
        for (j in 0 until itemsArray.length()) {
            val io = itemsArray.getJSONObject(j)
            itemsList.add(
                com.kebabzilla.data.model.OrderItem(
                    menuItemId = io.optLong("menu_item_id", 0L),
                    name = io.optString("name", "Item"),
                    variationName = io.optString("variation_name", io.optString("variation")).takeIf { it.isNotBlank() },
                    unitPricePaise = io.optLong("unit_price_paise", io.optLong("price_paise", 0L)),
                    quantity = io.optInt("quantity", 1),
                    lineTotalPaise = io.optLong("line_total_paise", 0L),
                    imageUrl = io.optString("image_url").takeIf { it.isNotBlank() }
                )
            )
        }
        val paymentMethod = o.optString("payment_method", "COD")
        val addrObj = o.optJSONObject("delivery_address")
        val addressSummary = if (addrObj != null) {
            listOfNotNull(
                addrObj.optString("house_number").takeIf { it.isNotBlank() },
                addrObj.optString("road").takeIf { it.isNotBlank() },
                addrObj.optString("area").takeIf { it.isNotBlank() },
                addrObj.optString("city").takeIf { it.isNotBlank() }
            ).joinToString(", ")
        } else {
            o.optString("delivery_address_summary", o.optString("address", ""))
        }

        val lat = if (o.has("latitude") && !o.isNull("latitude")) o.optDouble("latitude") else addrObj?.optDouble("latitude")
        val lng = if (o.has("longitude") && !o.isNull("longitude")) o.optDouble("longitude") else addrObj?.optDouble("longitude")

        return Order(
            orderId = o.optString("order_id", o.optString("id")),
            status = o.optString("status", "PLACED"),
            subtotalPaise = o.optLong("subtotal_paise", 0L),
            deliveryFeePaise = o.optLong("delivery_fee_paise", 0L),
            totalPaise = o.optLong("total_paise", 0L),
            address = addressSummary,
            items = itemsList,
            customerName = o.optString("customer_name", "Customer"),
            customerPhone = o.optString("customer_phone", ""),
            paymentMethod = paymentMethod,
            paymentStatus = o.optString("payment_status", "PAID"),
            deliveryOtp = o.optString("delivery_otp").takeIf { it.isNotBlank() },
            createdAt = o.optString("created_at"),
            latitude = lat,
            longitude = lng
        )
    }
}
