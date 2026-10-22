package com.kebabzilla

import com.kebabzilla.data.model.MenuItem
import com.kebabzilla.data.model.MenuVariation
import org.junit.Test
import org.junit.Assert.*

class ExampleUnitTest {
    @Test
    fun addition_isCorrect() {
        assertEquals(4, 2 + 2)
    }

    private fun createItem(vararg variationNames: String): MenuItem {
        return MenuItem(
            id = 1,
            name = "Test Food",
            pricePaise = 10000,
            variations = variationNames.map { MenuVariation(name = it, pricePaise = 10000) }
        )
    }

    @Test
    fun testPortionVariations() {
        val halfFull = createItem("Half", "Full")
        assertTrue(halfFull.isPortionOrSize)
        assertEquals("PORTION", halfFull.variationEyebrow)
        assertEquals("portion", halfFull.variationNoun)
        assertEquals("Choose size", halfFull.variationActionText)

        val regularLarge = createItem("Regular", "Large")
        assertTrue(regularLarge.isPortionOrSize)
        assertEquals("PORTION", regularLarge.variationEyebrow)
        assertEquals("portion", regularLarge.variationNoun)
        assertEquals("Choose size", regularLarge.variationActionText)

        val pieceCounts = createItem("2 Pcs", "4 Pcs", "6 Pcs")
        assertTrue(pieceCounts.isPortionOrSize)
        assertEquals("PORTION", pieceCounts.variationEyebrow)
        assertEquals("portion", pieceCounts.variationNoun)
        assertEquals("Choose size", pieceCounts.variationActionText)

        val quarterPlate = createItem("Quarter", "Half Plate", "Full Plate")
        assertTrue(quarterPlate.isPortionOrSize)
        assertEquals("PORTION", quarterPlate.variationEyebrow)
        assertEquals("portion", quarterPlate.variationNoun)
        assertEquals("Choose size", quarterPlate.variationActionText)
    }

    @Test
    fun testVersionAndOptionVariations() {
        val tikkaReshmi = createItem("Tikka", "Reshmi")
        assertFalse(tikkaReshmi.isPortionOrSize)
        assertEquals("OPTION", tikkaReshmi.variationEyebrow)
        assertEquals("option", tikkaReshmi.variationNoun)
        assertEquals("Choose", tikkaReshmi.variationActionText)

        val withWithoutBone = createItem("With Bone", "Without Bone")
        assertFalse(withWithoutBone.isPortionOrSize)
        assertEquals("OPTION", withWithoutBone.variationEyebrow)
        assertEquals("option", withWithoutBone.variationNoun)
        assertEquals("Choose", withWithoutBone.variationActionText)

        val boneless = createItem("Boneless", "With Bone")
        assertFalse(boneless.isPortionOrSize)
        assertEquals("OPTION", boneless.variationEyebrow)
        assertEquals("option", boneless.variationNoun)
        assertEquals("Choose", boneless.variationActionText)

        val flavors = createItem("Simply Salted", "Masala", "Cheesy")
        assertFalse(flavors.isPortionOrSize)
        assertEquals("OPTION", flavors.variationEyebrow)
        assertEquals("option", flavors.variationNoun)
        assertEquals("Choose", flavors.variationActionText)

        val gravyDry = createItem("Gravy", "Dry")
        assertFalse(gravyDry.isPortionOrSize)
        assertEquals("OPTION", gravyDry.variationEyebrow)
        assertEquals("option", gravyDry.variationNoun)
        assertEquals("Choose", gravyDry.variationActionText)

        val withWithoutEgg = createItem("With Egg", "Without Egg")
        assertFalse(withWithoutEgg.isPortionOrSize)
        assertEquals("OPTION", withWithoutEgg.variationEyebrow)
        assertEquals("option", withWithoutEgg.variationNoun)
        assertEquals("Choose", withWithoutEgg.variationActionText)
    }

    @Test
    fun testDeliveryFeeAndRoundOffCalculations() {
        val testItem = MenuItem(
            id = 10,
            name = "Chicken Biryani",
            pricePaise = 15000 // ₹150
        )
        com.kebabzilla.data.local.CartManager.clear()
        com.kebabzilla.data.local.CartManager.addItem(testItem, null, 1)
        assertEquals(15000L, com.kebabzilla.data.local.CartManager.getSubtotalPaise())

        // 1. Free delivery within free radius
        val freeEstimate = com.kebabzilla.data.model.DeliveryEstimate(
            distanceKm = 2.0,
            deliveryFeePaise = 0L,
            deliveryFeeInr = 0.0,
            rawDeliveryFeePaise = 0L,
            rawDeliveryFeeInr = 0.0,
            withinRadius = true
        )
        com.kebabzilla.data.local.CartManager.updateDeliveryEstimate(freeEstimate)
        assertEquals(0L, com.kebabzilla.data.local.CartManager.rawDeliveryFeePaise)
        assertEquals(0L, com.kebabzilla.data.local.CartManager.roundOffPaise)
        assertEquals(15000L, com.kebabzilla.data.local.CartManager.getTotalPaise())

        // 2. Free delivery by order threshold
        val thresholdFreeEstimate = com.kebabzilla.data.model.DeliveryEstimate(
            distanceKm = 6.0,
            deliveryFeePaise = 0L,
            deliveryFeeInr = 0.0,
            rawDeliveryFeePaise = 0L,
            rawDeliveryFeeInr = 0.0,
            isFreeByThreshold = true,
            freeDeliveryThresholdPaise = 10000L,
            withinRadius = true
        )
        com.kebabzilla.data.local.CartManager.updateDeliveryEstimate(thresholdFreeEstimate)
        assertEquals(0L, com.kebabzilla.data.local.CartManager.rawDeliveryFeePaise)
        assertEquals(0L, com.kebabzilla.data.local.CartManager.roundOffPaise)
        assertEquals(15000L, com.kebabzilla.data.local.CartManager.getTotalPaise())

        // 3. Distance fee with fractional paise (e.g. ₹26.25 -> 2625 paise)
        // Subtotal: 15000 (₹150), Fee: 2625 (₹26.25) -> Raw: 17625 (₹176.25)
        // Rounded: 176 INR -> 17600 paise -> Round-off: 17600 - 17625 = -25 paise (-₹0.25)
        val fractionalNegativeEstimate = com.kebabzilla.data.model.DeliveryEstimate(
            distanceKm = 4.75,
            deliveryFeePaise = 2700L,
            deliveryFeeInr = 27.0,
            rawDeliveryFeePaise = 2625L,
            rawDeliveryFeeInr = 26.25,
            withinRadius = true
        )
        com.kebabzilla.data.local.CartManager.updateDeliveryEstimate(fractionalNegativeEstimate)
        assertEquals(2625L, com.kebabzilla.data.local.CartManager.rawDeliveryFeePaise)
        assertEquals(-25L, com.kebabzilla.data.local.CartManager.roundOffPaise)
        assertEquals(17600L, com.kebabzilla.data.local.CartManager.getTotalPaise())

        // 4. Distance fee with positive round-off (e.g. ₹26.70 -> 2670 paise)
        // Subtotal: 15000 (₹150), Fee: 2670 (₹26.70) -> Raw: 17670 (₹176.70)
        // Rounded: 177 INR -> 17700 paise -> Round-off: 17700 - 17670 = +30 paise (+₹0.30)
        val fractionalPositiveEstimate = com.kebabzilla.data.model.DeliveryEstimate(
            distanceKm = 4.8,
            deliveryFeePaise = 2700L,
            deliveryFeeInr = 27.0,
            rawDeliveryFeePaise = 2670L,
            rawDeliveryFeeInr = 26.70,
            withinRadius = true
        )
        com.kebabzilla.data.local.CartManager.updateDeliveryEstimate(fractionalPositiveEstimate)
        assertEquals(2670L, com.kebabzilla.data.local.CartManager.rawDeliveryFeePaise)
        assertEquals(30L, com.kebabzilla.data.local.CartManager.roundOffPaise)
        assertEquals(17700L, com.kebabzilla.data.local.CartManager.getTotalPaise())

        // 5. Exact whole rupee fee (e.g. ₹30.00 -> 3000 paise)
        // Subtotal: 15000 (₹150), Fee: 3000 (₹30.00) -> Raw: 18000 (₹180.00) -> Round-off = 0
        val exactFeeEstimate = com.kebabzilla.data.model.DeliveryEstimate(
            distanceKm = 5.0,
            deliveryFeePaise = 3000L,
            deliveryFeeInr = 30.0,
            rawDeliveryFeePaise = 3000L,
            rawDeliveryFeeInr = 30.0,
            withinRadius = true
        )
        com.kebabzilla.data.local.CartManager.updateDeliveryEstimate(exactFeeEstimate)
        assertEquals(3000L, com.kebabzilla.data.local.CartManager.rawDeliveryFeePaise)
        assertEquals(0L, com.kebabzilla.data.local.CartManager.roundOffPaise)
        assertEquals(18000L, com.kebabzilla.data.local.CartManager.getTotalPaise())

        // 6. Outside delivery radius
        val outsideEstimate = com.kebabzilla.data.model.DeliveryEstimate(
            distanceKm = 18.0,
            deliveryFeePaise = 0L,
            deliveryFeeInr = 0.0,
            rawDeliveryFeePaise = 0L,
            rawDeliveryFeeInr = 0.0,
            withinRadius = false,
            maxRadiusKm = 10.0
        )
        com.kebabzilla.data.local.CartManager.updateDeliveryEstimate(outsideEstimate)
        assertTrue(com.kebabzilla.data.local.CartManager.isOutsideDeliveryZone)
        assertEquals(0L, com.kebabzilla.data.local.CartManager.rawDeliveryFeePaise)
        assertEquals(0L, com.kebabzilla.data.local.CartManager.roundOffPaise)

        com.kebabzilla.data.local.CartManager.clear()
    }
}
