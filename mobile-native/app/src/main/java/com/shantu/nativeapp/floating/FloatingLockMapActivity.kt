package com.shantu.nativeapp.floating

import android.app.KeyguardManager
import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RadialGradient
import android.graphics.Shader
import android.graphics.drawable.ColorDrawable
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.TextClock

/**
 * Lock-screen presentation for an already-running floating-navigation session.
 * It only borrows the service's live view/data; it never owns navigation, location,
 * recording, screen-wake, or keyguard-dismissal behavior.
 */
class FloatingLockMapActivity : Activity() {
    companion object {
        const val EXTRA_LOCK_SESSION = "floating_lock_session"
        const val ACTION_LOCK_VISIBLE = "shantu:floating-lock-visible"
        const val EXTRA_LOCK_VISIBLE = "visible"
        const val ACTION_SESSION_ENDED = "shantu:floating-lock-ended"
    }

    private var sessionToken: String? = null
    private var navigationView: FloatingNavigationView? = null
    private var attached = false
    private var receiverRegistered = false

    private val userPresentReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == Intent.ACTION_USER_PRESENT ||
                (intent.action == ACTION_SESSION_ENDED && intent.getStringExtra(EXTRA_LOCK_SESSION) == sessionToken)) finish()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED)
        }

        // The service starts this only after an actual screen-on event. Do not wake
        // the display from here; keep the lock screen and its authentication intact.
        window.setBackgroundDrawable(ColorDrawable(Color.BLACK))
        window.statusBarColor = Color.BLACK
        window.navigationBarColor = Color.BLACK
        window.setDimAmount(0f)
        window.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)

        sessionToken = intent.getStringExtra(EXTRA_LOCK_SESSION)?.takeIf(String::isNotBlank)
        navigationView = FloatingNavigationView(this).apply { lockscreenPresentation = true }
        setContentView(createLockscreenContent(navigationView!!))
    }

    override fun onStart() {
        super.onStart()

        val token = sessionToken
        val view = navigationView
        if (token == null || view == null || !isKeyguardLocked()) {
            finish()
            return
        }

        val didAttach = runCatching {
            FloatingNavigationService.attachLockscreenView(view, token)
        }.getOrDefault(false)
        if (!didAttach) {
            finish()
            return
        }

        attached = true
        // The lock-screen view must not turn its close/back affordances into a
        // request to stop the shared navigation or recording services.
        view.onClose = { finish() }
        view.onReturn = { finish() }
        registerUserPresentReceiver()

        // Close the race where the user unlocked between the initial check and attach.
        if (!isKeyguardLocked()) {
            finish()
            return
        }
        publishVisible(true)
    }

    override fun onResume() {
        super.onResume()
        // Screen-off can detach the service's View while this singleTop Activity
        // stays resumed. Always re-establish the live-session lease on resume.
        attachCurrentSession()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        detachViewIfNeeded()
        setIntent(intent)
        sessionToken = intent.getStringExtra(EXTRA_LOCK_SESSION)?.takeIf(String::isNotBlank)
        attachCurrentSession()
    }

    private fun attachCurrentSession() {
        val token = sessionToken
        val view = navigationView
        if (token == null || view == null || !isKeyguardLocked() ||
            !FloatingNavigationService.attachLockscreenView(view, token)) {
            finish()
            return
        }
        attached = true
        view.onClose = { finish() }
        view.onReturn = { finish() }
        registerUserPresentReceiver()
        publishVisible(true)
    }

    override fun onStop() {
        unregisterUserPresentReceiver()
        detachViewIfNeeded()
        super.onStop()
    }

    override fun onDestroy() {
        unregisterUserPresentReceiver()
        detachViewIfNeeded()
        navigationView = null
        super.onDestroy()
    }

    private fun isKeyguardLocked(): Boolean = runCatching {
        getSystemService(KeyguardManager::class.java)?.isKeyguardLocked == true
    }.getOrDefault(false)

    private fun registerUserPresentReceiver() {
        if (receiverRegistered) return
        val filter = IntentFilter(Intent.ACTION_USER_PRESENT).apply { addAction(ACTION_SESSION_ENDED) }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(userPresentReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("DEPRECATION")
            registerReceiver(userPresentReceiver, filter)
        }
        receiverRegistered = true
    }

    private fun unregisterUserPresentReceiver() {
        if (!receiverRegistered) return
        runCatching { unregisterReceiver(userPresentReceiver) }
        receiverRegistered = false
    }

    private fun detachViewIfNeeded() {
        if (!attached) return
        val view = navigationView
        if (view != null) runCatching { FloatingNavigationService.detachLockscreenView(view) }
        attached = false
        publishVisible(false)
    }

    private fun publishVisible(visible: Boolean) {
        runCatching {
            sendBroadcast(
                Intent(ACTION_LOCK_VISIBLE)
                    .setPackage(packageName)
                    .putExtra(EXTRA_LOCK_VISIBLE, visible),
            )
        }
    }

    private fun createLockscreenContent(view: FloatingNavigationView): View {
        val density = resources.displayMetrics.density
        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        val clock = TextClock(this).apply {
            format12Hour = "HH:mm"; format24Hour = "HH:mm"
            textSize = 64f
            setTextColor(0xffe6f2e9.toInt())
            typeface = android.graphics.Typeface.create("sans-serif-light", android.graphics.Typeface.NORMAL)
            gravity = Gravity.CENTER
        }
        root.addView(clock, FrameLayout.LayoutParams(-1, -2, Gravity.TOP).apply {
            topMargin = (58f * density).toInt()
        })
        val date = TextClock(this).apply {
            format12Hour = "M月d日  EEEE"; format24Hour = "M月d日  EEEE"
            textSize = 13f; setTextColor(0xffb7ccc0.toInt()); gravity = Gravity.CENTER
        }
        root.addView(date, FrameLayout.LayoutParams(-1, -2, Gravity.TOP).apply {
            topMargin = (139f * density).toInt()
        })
        // Fill a broad canvas before applying the mask. No inner clipped rectangle,
        // header, footer or source-information panel is painted in this presentation.
        val fadedMap = EllipticalFadeFrame(this)
        fadedMap.addView(view, FrameLayout.LayoutParams(-1, -1))
        root.addView(fadedMap, FrameLayout.LayoutParams(-1, (520f * density).toInt(), Gravity.CENTER).apply {
            topMargin = (90f * density).toInt()
        })
        return root
    }

    /** Masks the complete native map/view tree, fading to the real lock screen. */
    private class EllipticalFadeFrame(context: Context) : FrameLayout(context) {
        private val maskPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            xfermode = PorterDuffXfermode(PorterDuff.Mode.DST_IN)
        }

        override fun dispatchDraw(canvas: Canvas) {
            if (width <= 0 || height <= 0) {
                super.dispatchDraw(canvas)
                return
            }

            val layer = canvas.saveLayer(0f, 0f, width.toFloat(), height.toFloat(), null)
            super.dispatchDraw(canvas)

            val cx = width / 2f
            val cy = height / 2f
            val rx = (width * .49f).coerceAtLeast(1f)
            val ry = (height * .49f).coerceAtLeast(1f)
            maskPaint.shader = RadialGradient(
                0f,
                0f,
                1f,
                intArrayOf(
                    Color.WHITE,
                    Color.WHITE,
                    0xeeffffff.toInt(),
                    0xaaffffff.toInt(),
                    0x55ffffff.toInt(),
                    0x11ffffff.toInt(),
                    Color.TRANSPARENT,
                ),
                floatArrayOf(0f, .28f, .42f, .57f, .73f, .88f, 1f),
                Shader.TileMode.CLAMP,
            )
            canvas.save()
            canvas.translate(cx, cy)
            canvas.scale(rx, ry)
            canvas.drawRect(-cx / rx, -cy / ry, cx / rx, cy / ry, maskPaint)
            canvas.restore()
            maskPaint.shader = null
            canvas.restoreToCount(layer)
        }
    }
}
