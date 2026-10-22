package com.kebabzilla.utils

import android.content.Context
import androidx.appcompat.app.AppCompatDelegate

object ThemeManager {
    const val MODE_SYSTEM = "SYSTEM"
    const val MODE_LIGHT = "LIGHT"
    const val MODE_DARK = "DARK"

    private const val PREF_KEY_THEME = "app_theme_mode"

    fun getThemeMode(context: Context): String {
        val prefs = context.getSharedPreferences(Constants.PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(PREF_KEY_THEME, MODE_SYSTEM) ?: MODE_SYSTEM
    }

    fun setThemeMode(context: Context, mode: String) {
        val prefs = context.getSharedPreferences(Constants.PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(PREF_KEY_THEME, mode).apply()
        applyTheme(mode)
    }

    fun applyTheme(mode: String) {
        when (mode) {
            MODE_LIGHT -> AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_NO)
            MODE_DARK -> AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_YES)
            else -> AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM)
        }
    }

    fun initTheme(context: Context) {
        applyTheme(getThemeMode(context))
    }
}
