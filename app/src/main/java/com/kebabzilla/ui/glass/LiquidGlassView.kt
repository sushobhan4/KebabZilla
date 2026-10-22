package com.kebabzilla.ui.glass

import android.content.Context
import android.content.res.Configuration
import android.graphics.*
import android.os.Build
import android.util.AttributeSet
import android.view.View
import android.widget.FrameLayout
import androidx.core.content.ContextCompat
import com.kebabzilla.R
import kotlin.math.roundToInt

/**
 * Liquid Glass Container View implementing exact SDF refraction, chromatic dispersion,
 * specular rim highlighting, and StackBlur backdrop optics matching AndroidLiquidGlass.
 *
 * Includes graceful fallback for pre-API 33 / unsupported devices (blurred lightly tinted glass container)
 * and anti-aliased bilinear texture filtering to prevent pixelation.
 */
class LiquidGlassView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : FrameLayout(context, attrs, defStyleAttr) {

    // 1. Corner radius fraction
    var cornerRadiusFrac: Float = 0.00f
        set(value) {
            field = value.coerceAtLeast(0f)
            invalidate()
        }

    // 2. Blur radius in dp
    var blurRadiusDp: Float = 6.5f
        set(value) {
            field = value.coerceAtLeast(0f)
            invalidate()
        }

    // 3. Refraction height fraction
    var refractionHeightFrac: Float = 0.25f
        set(value) {
            field = value.coerceAtLeast(0f)
            invalidate()
        }

    // 4. Refraction amount fraction
    var refractionAmountFrac: Float = 0.35f
        set(value) {
            field = value.coerceAtLeast(0f)
            invalidate()
        }

    // 5. Chromatic aberration intensity
    var chromaticAberration: Float = 1.65f
        set(value) {
            field = value.coerceIn(0f, 5f)
            invalidate()
        }

    // Backward-compatibility properties
    var cornerRadiusDp: Float
        get() = (minOf(width, height) * 0.5f * cornerRadiusFrac) / density
        set(value) {
            val minDim = if (width > 0 && height > 0) minOf(width, height) / density else 200f
            cornerRadiusFrac = (value / (minDim * 0.5f)).coerceAtLeast(0f)
        }

    var refractionHeightDp: Float
        get() = (minOf(width, height) * 0.5f * refractionHeightFrac) / density
        set(value) {
            val minDim = if (width > 0 && height > 0) minOf(width, height) / density else 200f
            refractionHeightFrac = (value / (minDim * 0.5f)).coerceAtLeast(0f)
        }

    var refractionAmountDp: Float
        get() = (minOf(width, height) * refractionAmountFrac) / density
        set(value) {
            val minDim = if (width > 0 && height > 0) minOf(width, height) / density else 200f
            refractionAmountFrac = (value / minDim).coerceAtLeast(0f)
        }

    var providerView: View? = null

    private val density = resources.displayMetrics.density

    // Smooth bilinear filtering & dithering enabled to eliminate any pixelation
    private val glassPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG or Paint.DITHER_FLAG).apply {
        isFilterBitmap = true
        isDither = true
    }
    private val tintPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
    }
    private val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 1f * density
    }
    private val highlightPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG or Paint.DITHER_FLAG).apply {
        isFilterBitmap = true
        isDither = true
    }

    private var rawBackdropBitmap: Bitmap? = null
    private var rawBackdropCanvas: Canvas? = null
    private var blurredBitmap: Bitmap? = null
    private val matrix = Matrix()

    private val locationGlass = IntArray(2)
    private val locationProvider = IntArray(2)

    private var runtimeShader: Any? = null
    private var highlightShader: Any? = null
    private var isAgslSupported = false

    init {
        setWillNotDraw(false)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            try {
                runtimeShader = android.graphics.RuntimeShader(LiquidGlassShaders.RoundedRectRefractionWithDispersionShaderString)
                highlightShader = android.graphics.RuntimeShader(LiquidGlassShaders.DefaultHighlightShaderString)
                isAgslSupported = true
            } catch (e: Exception) {
                isAgslSupported = false
            }
        }
    }

    override fun onDraw(canvas: Canvas) {
        val w = width
        val h = height
        if (w <= 0 || h <= 0) {
            super.onDraw(canvas)
            return
        }

        val provider = providerView
        if (provider != null && provider.visibility == View.VISIBLE) {
            drawLiquidGlass(canvas, provider, w, h)
        } else {
            drawFallbackGlass(canvas, w, h)
        }

        super.onDraw(canvas)
    }

    private fun drawLiquidGlass(canvas: Canvas, provider: View, w: Int, h: Int) {
        // High-fidelity downscaling: 1.0f (native resolution) when unblurred, 0.67f when blurred.
        // Prevents blocky pixelation while maintaining lightning-fast blur speed.
        val downscale = if (blurRadiusDp <= 0f) 1.0f else 0.67f
        val bw = (w * downscale).roundToInt().coerceAtLeast(1)
        val bh = (h * downscale).roundToInt().coerceAtLeast(1)

        var bmp = rawBackdropBitmap
        if (bmp == null || bmp.width != bw || bmp.height != bh || bmp.isRecycled) {
            bmp?.recycle()
            bmp = Bitmap.createBitmap(bw, bh, Bitmap.Config.ARGB_8888)
            rawBackdropBitmap = bmp
            rawBackdropCanvas = Canvas(bmp).apply {
                drawFilter = PaintFlagsDrawFilter(0, Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
            }

            blurredBitmap?.recycle()
            blurredBitmap = Bitmap.createBitmap(bw, bh, Bitmap.Config.ARGB_8888)
        }

        val bCanvas = rawBackdropCanvas ?: return

        getLocationInWindow(locationGlass)
        provider.getLocationInWindow(locationProvider)
        val offsetX = (locationGlass[0] - locationProvider[0]).toFloat()
        val offsetY = (locationGlass[1] - locationProvider[1]).toFloat()

        // 1. Draw solid background color (brand_paper) to guarantee 100% opacity,
        // preventing any transparent edge bleeding or ghosting.
        val paperColor = ContextCompat.getColor(context, R.color.brand_paper)
        bCanvas.save()
        bCanvas.drawColor(paperColor, PorterDuff.Mode.SRC)
        bCanvas.scale(downscale, downscale)
        bCanvas.translate(-offsetX, -offsetY)
        try {
            provider.draw(bCanvas)
        } catch (e: Throwable) {
            // Protect against any hardware bitmap drawing attempts on software canvas
        } finally {
            bCanvas.restore()
        }

        // 2. High-performance, artifact-free StackBlur on the underlying backdrop.
        val blurRadiusPx = (blurRadiusDp * density * downscale * 0.5f).roundToInt().coerceIn(0, 100)
        val processedBmp = if (blurRadiusPx > 0) {
            FastBlur.blur(bmp, blurRadiusPx, blurredBitmap)
        } else {
            bmp
        }

        val contentShader = BitmapShader(processedBmp, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP)
        // Enable hardware bilinear texture filtering on API 33+ to eliminate pixelation
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            contentShader.setFilterMode(BitmapShader.FILTER_MODE_LINEAR)
        }
        matrix.reset()
        matrix.setScale(1f / downscale, 1f / downscale)
        contentShader.setLocalMatrix(matrix)

        val isNight = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES

        // 3. Check for AGSL Liquid Glass support
        if (isAgslSupported && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && runtimeShader is android.graphics.RuntimeShader) {
            try {
                val minDimension = minOf(w, h).toFloat()
                val rPx = (minDimension * 0.5f) * cornerRadiusFrac
                val refractionHeightPx = refractionHeightFrac * minDimension * 0.5f
                val refractionAmountPx = -(refractionAmountFrac * minDimension) // Inward convex lens optics

                val shader = runtimeShader as android.graphics.RuntimeShader
                shader.setInputShader("content", contentShader)
                shader.setFloatUniform("size", w.toFloat(), h.toFloat())
                shader.setFloatUniform("offset", 0f, 0f)
                shader.setFloatUniform("cornerRadii", rPx, rPx, rPx, rPx)
                shader.setFloatUniform("refractionHeight", refractionHeightPx)
                shader.setFloatUniform("refractionAmount", refractionAmountPx)
                shader.setFloatUniform("depthEffect", 1.0f)
                shader.setFloatUniform("chromaticAberration", chromaticAberration)

                glassPaint.shader = shader
                // Sides and top are in oblivion (2000px virtual overflow), draw full width & height
                canvas.drawRect(0f, 0f, w.toFloat(), h.toFloat(), glassPaint)

                // Specular rim highlight on bottom edge
                if (highlightShader is android.graphics.RuntimeShader) {
                    val hShader = highlightShader as android.graphics.RuntimeShader
                    hShader.setFloatUniform("size", w.toFloat(), h.toFloat())
                    hShader.setFloatUniform("cornerRadii", rPx, rPx, rPx, rPx)
                    val rimAlpha = if (isNight) 100 else 140
                    hShader.setColorUniform("color", Color.argb(rimAlpha, 255, 255, 255))
                    hShader.setFloatUniform("angle", (135f * Math.PI / 180f).toFloat())
                    hShader.setFloatUniform("falloff", 4.0f)

                    highlightPaint.shader = hShader
                    canvas.drawRect(0f, 0f, w.toFloat(), h.toFloat(), highlightPaint)
                }

                // Subtle top and bottom rim border lines (zero side borders)
                strokePaint.color = if (isNight) {
                    Color.argb(45, 255, 255, 255)
                } else {
                    Color.argb(35, 255, 255, 255)
                }
                canvas.drawLine(0f, 0f, w.toFloat(), 0f, strokePaint)
                canvas.drawLine(0f, h.toFloat(), w.toFloat(), h.toFloat(), strokePaint)
            } catch (e: Exception) {
                // Fallback if shader evaluation encounters an unexpected runtime error
                drawBlurredTintedFallback(canvas, contentShader, w, h, isNight)
            }
        } else {
            // Fallback for devices without AGSL support (Android 12 and below / pre-API 33):
            // Renders a smooth blurred, lightly tinted frosted container
            drawBlurredTintedFallback(canvas, contentShader, w, h, isNight)
        }
    }

    /**
     * Fallback for devices that don't support AGSL RuntimeShader (Android 12 and below / unsupported GPUs).
     * Renders the underlying backdrop with smooth StackBlur and a subtle, lightly tinted translucent frosted glaze.
     */
    private fun drawBlurredTintedFallback(canvas: Canvas, contentShader: BitmapShader, w: Int, h: Int, isNight: Boolean) {
        // 1. Draw smooth blurred underlying backdrop
        glassPaint.shader = contentShader
        canvas.drawRect(0f, 0f, w.toFloat(), h.toFloat(), glassPaint)

        // 2. Apply subtle, light translucent frosted tint
        tintPaint.color = if (isNight) {
            Color.argb(185, 24, 26, 25) // Light dark-mode tinted glaze
        } else {
            Color.argb(165, 255, 255, 255) // Light white frosted glaze
        }
        canvas.drawRect(0f, 0f, w.toFloat(), h.toFloat(), tintPaint)

        // 3. Subtle top and bottom divider lines
        strokePaint.color = if (isNight) {
            Color.argb(45, 255, 255, 255)
        } else {
            Color.argb(35, 0, 0, 0)
        }
        canvas.drawLine(0f, 0f, w.toFloat(), 0f, strokePaint)
        canvas.drawLine(0f, h.toFloat(), w.toFloat(), h.toFloat(), strokePaint)
    }

    /**
     * Fallback for when no backdrop provider view is attached or visible.
     * Renders a clean, lightly tinted frosted glass header container.
     */
    private fun drawFallbackGlass(canvas: Canvas, w: Int, h: Int) {
        val isNight = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES

        // Lightly tinted container
        tintPaint.color = if (isNight) {
            Color.argb(230, 24, 26, 25)
        } else {
            Color.argb(230, 255, 255, 255)
        }
        canvas.drawRect(0f, 0f, w.toFloat(), h.toFloat(), tintPaint)

        // Subtle top and bottom borders
        strokePaint.color = if (isNight) {
            Color.argb(45, 255, 255, 255)
        } else {
            Color.argb(35, 0, 0, 0)
        }
        canvas.drawLine(0f, 0f, w.toFloat(), 0f, strokePaint)
        canvas.drawLine(0f, h.toFloat(), w.toFloat(), h.toFloat(), strokePaint)
    }
}
