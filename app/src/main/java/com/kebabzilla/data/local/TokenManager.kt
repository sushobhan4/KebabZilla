package com.kebabzilla.data.local

import android.content.Context
import android.content.SharedPreferences
import com.kebabzilla.utils.Constants

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

    fun isLoggedIn(): Boolean {
        return !getAccessToken().isNullOrBlank()
    }

    fun clearSession() {
        prefs.edit().clear().apply()
    }
}
