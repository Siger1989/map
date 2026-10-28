package com.shantu.nativeapp.ui

import android.content.res.ColorStateList
import android.graphics.drawable.GradientDrawable
import android.view.View
import android.widget.EditText
import android.widget.ImageView
import android.widget.TextView
import com.shantu.nativeapp.appearance.NativeAppearanceTokens
import java.util.WeakHashMap

/** Semantic UI roles for native controls. Data/map colors must never be registered here. */
enum class NativeThemeRole {
    SURFACE, RAISED, INK, ACCENT, CLOSE, ACTIVE, ACTIVE_INK,
    BUTTON, BUTTON_INK, FIELD, SELECTED, DANGER, LINE, MUTED, ON_ACCENT,
}

enum class NativeThemeTarget { TEXT, HINT, BACKGROUND, TINT }

/** Explicit view-to-token bindings; unregistered drawable/text colors remain user data. */
class NativeThemeBindings {
    private data class Binding(
        val role: NativeThemeRole,
        val target: NativeThemeTarget,
        val cornerRadiusPx: Float = 0f,
    )

    private val bindings = WeakHashMap<View, MutableList<Binding>>()
    private var tokens: NativeAppearanceTokens? = null

    fun bindText(view: TextView, role: NativeThemeRole): TextView = bind(view, role, NativeThemeTarget.TEXT) as TextView
    fun bindHint(view: EditText, role: NativeThemeRole): EditText = bind(view, role, NativeThemeTarget.HINT) as EditText
    fun bindTint(view: ImageView, role: NativeThemeRole): ImageView = bind(view, role, NativeThemeTarget.TINT) as ImageView

    fun bindBackground(view: View, role: NativeThemeRole, cornerRadiusPx: Float = 0f): View =
        bind(view, role, NativeThemeTarget.BACKGROUND, cornerRadiusPx)

    fun apply(next: NativeAppearanceTokens) {
        tokens = next
        bindings.entries.toList().forEach { (view, entries) -> entries.forEach { apply(view, it, next) } }
    }

    private fun bind(view: View, role: NativeThemeRole, target: NativeThemeTarget, radius: Float = 0f): View {
        val bucket = bindings.getOrPut(view) { mutableListOf() }
        bucket.removeAll { it.target == target }
        val binding = Binding(role, target, radius)
        bucket += binding
        tokens?.let { apply(view, binding, it) }
        return view
    }

    private fun apply(view: View, binding: Binding, colors: NativeAppearanceTokens) {
        val color = colors.color(binding.role)
        when (binding.target) {
            NativeThemeTarget.TEXT -> (view as? TextView)?.setTextColor(color)
            NativeThemeTarget.HINT -> (view as? EditText)?.setHintTextColor(color)
            NativeThemeTarget.TINT -> (view as? ImageView)?.imageTintList = ColorStateList.valueOf(color)
            NativeThemeTarget.BACKGROUND -> {
                if (binding.cornerRadiusPx > 0f) {
                    view.background = GradientDrawable().apply {
                        setColor(color)
                        cornerRadius = binding.cornerRadiusPx
                    }
                } else view.setBackgroundColor(color)
            }
        }
    }

    private fun NativeAppearanceTokens.color(role: NativeThemeRole): Int = when (role) {
        NativeThemeRole.SURFACE -> surface
        NativeThemeRole.RAISED -> raised
        NativeThemeRole.INK -> ink
        NativeThemeRole.ACCENT -> accent
        NativeThemeRole.CLOSE -> close
        NativeThemeRole.ACTIVE -> active
        NativeThemeRole.ACTIVE_INK -> activeInk
        NativeThemeRole.BUTTON -> button
        NativeThemeRole.BUTTON_INK -> buttonInk
        NativeThemeRole.FIELD -> field
        NativeThemeRole.SELECTED -> selected
        NativeThemeRole.DANGER -> danger
        NativeThemeRole.LINE -> line
        NativeThemeRole.MUTED -> muted
        NativeThemeRole.ON_ACCENT -> onAccent
    }
}
