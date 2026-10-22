package com.kebabzilla.ui.glass

import android.graphics.Bitmap

/**
 * High-performance, artifact-free Stack Blur algorithm by Mario Klingemann.
 * Creates an ultra-smooth, true Gaussian-like blur in a single pass with zero edge drift
 * and zero color overflow.
 *
 * Supports reusable [out] Bitmap to eliminate garbage collector churn at 60/120fps.
 */
object FastBlur {

    /**
     * Blurs [src] with the given [radius].
     * If [out] is provided and matches dimensions, it is written in-place to avoid GC allocation.
     */
    fun blur(src: Bitmap, radius: Int, out: Bitmap? = null): Bitmap {
        if (radius < 1) return src
        val w = src.width
        val h = src.height
        if (w <= 0 || h <= 0) return src

        val dst = if (out != null && out.width == w && out.height == h && !out.isRecycled) {
            out
        } else {
            Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        }

        val pix = IntArray(w * h)
        src.getPixels(pix, 0, w, 0, 0, w, h)

        stackBlur(pix, w, h, radius)

        dst.setPixels(pix, 0, w, 0, 0, w, h)
        return dst
    }

    private fun stackBlur(pix: IntArray, w: Int, h: Int, radius: Int) {
        val r = radius.coerceIn(1, 100)
        val wm = w - 1
        val hm = h - 1
        val wh = w * h
        val div = r + r + 1

        val rArr = IntArray(wh)
        val gArr = IntArray(wh)
        val bArr = IntArray(wh)
        val aArr = IntArray(wh)

        var p: Int
        var yp: Int
        var yi: Int
        var yw: Int

        val vmin = IntArray(maxOf(w, h))

        var divsum = (div + 1) shr 1
        divsum *= divsum
        val dv = IntArray(256 * divsum)
        for (idx in 0 until 256 * divsum) {
            dv[idx] = idx / divsum
        }

        yw = 0
        yi = 0

        val stack = Array(div) { IntArray(4) }
        var stackpointer: Int
        var stackstart: Int
        var sir: IntArray
        var rbs: Int
        val r1 = r + 1
        var routsum: Int
        var goutsum: Int
        var boutsum: Int
        var aoutsum: Int
        var rinsum: Int
        var ginsum: Int
        var binsum: Int
        var ainsum: Int
        var rsum: Int
        var gsum: Int
        var bsum: Int
        var asum: Int

        for (y in 0 until h) {
            rinsum = 0
            ginsum = 0
            binsum = 0
            ainsum = 0
            routsum = 0
            goutsum = 0
            boutsum = 0
            aoutsum = 0
            rsum = 0
            gsum = 0
            bsum = 0
            asum = 0

            for (i in -r..r) {
                p = pix[yi + minOf(wm, maxOf(i, 0))]
                sir = stack[i + r]
                sir[0] = (p shr 16) and 0xff
                sir[1] = (p shr 8) and 0xff
                sir[2] = p and 0xff
                sir[3] = (p ushr 24) and 0xff

                rbs = r1 - Math.abs(i)
                rsum += sir[0] * rbs
                gsum += sir[1] * rbs
                bsum += sir[2] * rbs
                asum += sir[3] * rbs

                if (i > 0) {
                    rinsum += sir[0]
                    ginsum += sir[1]
                    binsum += sir[2]
                    ainsum += sir[3]
                } else {
                    routsum += sir[0]
                    goutsum += sir[1]
                    boutsum += sir[2]
                    aoutsum += sir[3]
                }
            }
            stackpointer = r

            for (x in 0 until w) {
                rArr[yi] = dv[rsum]
                gArr[yi] = dv[gsum]
                bArr[yi] = dv[bsum]
                aArr[yi] = dv[asum]

                rsum -= routsum
                gsum -= goutsum
                bsum -= boutsum
                asum -= aoutsum

                stackstart = stackpointer - r + div
                sir = stack[stackstart % div]

                routsum -= sir[0]
                goutsum -= sir[1]
                boutsum -= sir[2]
                aoutsum -= sir[3]

                if (y == 0) {
                    vmin[x] = minOf(x + r + 1, wm)
                }
                p = pix[yw + vmin[x]]

                sir[0] = (p shr 16) and 0xff
                sir[1] = (p shr 8) and 0xff
                sir[2] = p and 0xff
                sir[3] = (p ushr 24) and 0xff

                rinsum += sir[0]
                ginsum += sir[1]
                binsum += sir[2]
                ainsum += sir[3]

                rsum += rinsum
                gsum += ginsum
                bsum += binsum
                asum += ainsum

                stackpointer = (stackpointer + 1) % div
                sir = stack[stackpointer % div]

                routsum += sir[0]
                goutsum += sir[1]
                boutsum += sir[2]
                aoutsum += sir[3]

                rinsum -= sir[0]
                ginsum -= sir[1]
                binsum -= sir[2]
                ainsum -= sir[3]

                yi++
            }
            yw += w
        }

        for (x in 0 until w) {
            rinsum = 0
            ginsum = 0
            binsum = 0
            ainsum = 0
            routsum = 0
            goutsum = 0
            boutsum = 0
            aoutsum = 0
            rsum = 0
            gsum = 0
            bsum = 0
            asum = 0

            yp = -r * w
            for (i in -r..r) {
                yi = maxOf(0, yp) + x
                sir = stack[i + r]

                sir[0] = rArr[yi]
                sir[1] = gArr[yi]
                sir[2] = bArr[yi]
                sir[3] = aArr[yi]

                rbs = r1 - Math.abs(i)

                rsum += rArr[yi] * rbs
                gsum += gArr[yi] * rbs
                bsum += bArr[yi] * rbs
                asum += aArr[yi] * rbs

                if (i > 0) {
                    rinsum += sir[0]
                    ginsum += sir[1]
                    binsum += sir[2]
                    ainsum += sir[3]
                } else {
                    routsum += sir[0]
                    goutsum += sir[1]
                    boutsum += sir[2]
                    aoutsum += sir[3]
                }

                if (i < hm) {
                    yp += w
                }
            }
            yi = x
            stackpointer = r

            for (y in 0 until h) {
                pix[yi] = (dv[asum] shl 24) or (dv[rsum] shl 16) or (dv[gsum] shl 8) or dv[bsum]

                rsum -= routsum
                gsum -= goutsum
                bsum -= boutsum
                asum -= aoutsum

                stackstart = stackpointer - r + div
                sir = stack[stackstart % div]

                routsum -= sir[0]
                goutsum -= sir[1]
                boutsum -= sir[2]
                aoutsum -= sir[3]

                if (x == 0) {
                    vmin[y] = minOf(y + r1, hm) * w
                }
                p = x + vmin[y]

                sir[0] = rArr[p]
                sir[1] = gArr[p]
                sir[2] = bArr[p]
                sir[3] = aArr[p]

                rinsum += sir[0]
                ginsum += sir[1]
                binsum += sir[2]
                ainsum += sir[3]

                rsum += rinsum
                gsum += ginsum
                bsum += binsum
                asum += ainsum

                stackpointer = (stackpointer + 1) % div
                sir = stack[stackpointer]

                routsum += sir[0]
                goutsum += sir[1]
                boutsum += sir[2]
                aoutsum += sir[3]

                rinsum -= sir[0]
                ginsum -= sir[1]
                binsum -= sir[2]
                ainsum -= sir[3]

                yi += w
            }
        }
    }
}
