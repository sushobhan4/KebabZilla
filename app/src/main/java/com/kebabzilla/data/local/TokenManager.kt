package com.kebabzilla.data.local

import android.content.Context
import android.content.SharedPreferences
import com.kebabzilla.data.model.Address
import com.kebabzilla.data.model.User
import com.kebabzilla.utils.Constants
import org.json.JSONArray
import org.json.JSONObject

class TokenManager(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences(Constants.PREFS_NAME, Context.MODE_PRIVATE)

    fun saveAccessToken(token: String) {
        prefs.edit().putString(Constants.KEY_ACCESS_TOKEN, token).apply()
    }

    fun getAccessToken(): String? {
        return prefs.getString(Constants.KEY_ACCESS_TOKEN, null)
    }

    fun saveCsrfToken(token: String) {
        prefs.edit().putString(Constants.KEY_CSRF_TOKEN, token).apply()
    }

    fun getCsrfToken(): String? {
        return prefs.getString(Constants.KEY_CSRF_TOKEN, null)
    }

    fun saveUserRole(role: String) {
        prefs.edit().putString(Constants.KEY_USER_ROLE, role).apply()
    }

    fun getUserRole(): String {
        return prefs.getString(Constants.KEY_USER_ROLE, Constants.ROLE_USER) ?: Constants.ROLE_USER
    }

    fun saveUserEmail(email: String) {
        prefs.edit().putString(Constants.KEY_USER_EMAIL, email).apply()
    }

    fun getUserEmail(): String? {
        return prefs.getString(Constants.KEY_USER_EMAIL, null)
    }

    fun saveUserName(name: String) {
        prefs.edit().putString(Constants.KEY_USER_NAME, name).apply()
    }

    fun getUserName(): String? {
        return prefs.getString(Constants.KEY_USER_NAME, null)
    }

    fun saveUserPhone(phone: String?) {
        if (!phone.isNullOrBlank()) {
            prefs.edit().putString(Constants.KEY_USER_PHONE, phone).apply()
        } else {
            prefs.edit().remove(Constants.KEY_USER_PHONE).apply()
        }
    }

    fun getUserPhone(): String? {
        return prefs.getString(Constants.KEY_USER_PHONE, null)
    }

    fun saveUserProfile(user: User) {
        prefs.edit()
            .putLong(Constants.KEY_USER_ID, user.id)
            .putString(Constants.KEY_USER_NAME, user.name)
            .putString(Constants.KEY_USER_EMAIL, user.email)
            .putString(Constants.KEY_USER_PHONE, user.phone)
            .putString(Constants.KEY_USER_ROLE, user.role)
            .putBoolean(Constants.KEY_USER_PROMO_CONSENT, user.promotionalConsent)
            .putString(Constants.KEY_USER_ADDRESSES, serializeAddresses(user.addresses))
            .putLong(Constants.KEY_PROFILE_LAST_SYNCED, System.currentTimeMillis())
            .apply()
    }

    fun getUserProfile(): User? {
        if (!isLoggedIn()) return null
        val email = getUserEmail() ?: return null
        val name = getUserName() ?: "Customer"
        val phone = getUserPhone()
        val role = getUserRole()
        val id = prefs.getLong(Constants.KEY_USER_ID, 1L)
        val promo = prefs.getBoolean(Constants.KEY_USER_PROMO_CONSENT, true)
        val addresses = getAddresses()
        return User(
            id = id,
            name = name,
            email = email,
            phone = phone,
            role = role,
            addresses = addresses,
            promotionalConsent = promo
        )
    }

    fun isProfileCached(): Boolean {
        return isLoggedIn() && !getUserName().isNullOrBlank() && !getUserEmail().isNullOrBlank()
    }

    fun saveAddresses(addresses: List<Address>) {
        prefs.edit()
            .putString(Constants.KEY_USER_ADDRESSES, serializeAddresses(addresses))
            .apply()
    }

    fun getAddresses(): List<Address> {
        val jsonStr = prefs.getString(Constants.KEY_USER_ADDRESSES, null)
        return deserializeAddresses(jsonStr)
    }

    fun getDefaultAddress(): Address? {
        val addresses = getAddresses()
        return addresses.firstOrNull { it.isDefault } ?: addresses.firstOrNull()
    }

    fun isLoggedIn(): Boolean {
        return !getAccessToken().isNullOrBlank()
    }

    fun clearSession() {
        prefs.edit().clear().apply()
    }

    private fun serializeAddresses(addresses: List<Address>): String {
        val array = JSONArray()
        for (a in addresses) {
            val obj = JSONObject().apply {
                if (!a.id.isNullOrBlank()) put("id", a.id)
                put("label", a.label)
                put("house_number", a.houseNumber ?: "")
                put("road", a.road ?: "")
                put("area", a.area ?: "")
                put("city", a.city)
                put("pincode", a.pincode ?: "")
                put("landmark", a.landmark ?: "")
                if (a.latitude != null) put("latitude", a.latitude)
                if (a.longitude != null) put("longitude", a.longitude)
                put("is_default", a.isDefault)
            }
            array.put(obj)
        }
        return array.toString()
    }

    private fun deserializeAddresses(jsonStr: String?): List<Address> {
        if (jsonStr.isNullOrBlank()) return emptyList()
        return try {
            val array = JSONArray(jsonStr)
            val list = mutableListOf<Address>()
            for (i in 0 until array.length()) {
                val obj = array.getJSONObject(i)
                val lat = if (obj.has("latitude") && !obj.isNull("latitude")) obj.optDouble("latitude") else null
                val lng = if (obj.has("longitude") && !obj.isNull("longitude")) obj.optDouble("longitude") else null
                val idStr = when {
                    obj.has("id") && !obj.isNull("id") -> obj.optString("id")
                    obj.has("address_id") && !obj.isNull("address_id") -> obj.optString("address_id")
                    else -> null
                }?.takeIf { it.isNotBlank() }
                list.add(
                    Address(
                        id = idStr,
                        label = obj.optString("label", "Home"),
                        houseNumber = obj.optString("house_number").takeIf { it.isNotBlank() },
                        road = obj.optString("road").takeIf { it.isNotBlank() },
                        area = obj.optString("area").takeIf { it.isNotBlank() },
                        city = obj.optString("city", "Amtala"),
                        pincode = obj.optString("pincode").takeIf { it.isNotBlank() },
                        landmark = obj.optString("landmark").takeIf { it.isNotBlank() },
                        latitude = lat,
                        longitude = lng,
                        isDefault = obj.optBoolean("is_default", false)
                    )
                )
            }
            list
        } catch (_: Exception) {
            emptyList()
        }
    }
}
