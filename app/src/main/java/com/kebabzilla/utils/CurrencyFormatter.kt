package com.kebabzilla.utils

import java.text.NumberFormat
import java.util.Locale

object CurrencyFormatter {

    /**
     * Converts integer paise (1 INR = 100 paise) to a formatted Indian Rupee (INR) currency string.
     * e.g., 25000 paise -> "₹250" or "₹250.50"
     */
    fun formatPaise(paise: Long): String {
        val rupees = paise / 100.0
        val locale = Locale.forLanguageTag("en-IN")
        val formatter = NumberFormat.getCurrencyInstance(locale)
        val formatted = formatter.format(rupees)
        // Clean trailing zero decimals if integer value (e.g. "₹250.00" -> "₹250")
        return if (paise % 100 == 0L) {
            formatted.replace(".00", "")
        } else {
            formatted
        }
    }

    /**
     * Converts integer paise to double rupees.
     */
    fun paiseToRupees(paise: Long): Double = paise / 100.0

    /**
     * Converts double rupees to integer paise.
     */
    fun rupeesToPaise(rupees: Double): Long = (rupees * 100).toLong()
}
