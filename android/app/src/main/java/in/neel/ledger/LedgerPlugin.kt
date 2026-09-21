package `in`.neel.ledger

import android.content.Context
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * The only native surface the web app talks to.
 *
 * It does one thing: hand the widget the figures the app has already
 * computed, and ask Android to redraw. Amounts cross as strings of integer
 * paise — never as JavaScript numbers-of-rupees — so nothing can be lost to
 * floating point on the way out of the web layer.
 */
@CapacitorPlugin(name = "Ledger")
class LedgerPlugin : Plugin() {

    companion object {
        /** Shared with Capacitor's Preferences plugin so the widget can read it. */
        private const val STORE = "CapacitorStorage"
        private const val PREFIX = "ledger.widget."

        private val PAISE_KEYS = listOf("ownedMoney", "netPosition", "owedToMe", "iOwe", "cash", "digital")
    }

    @PluginMethod
    fun updateWidget(call: PluginCall) {
        val prefs = context.getSharedPreferences(STORE, Context.MODE_PRIVATE)
        val editor = prefs.edit()

        for (key in PAISE_KEYS) {
            val value = call.getString(key)
            // A missing figure is left alone rather than written as zero; the
            // widget would otherwise claim you have nothing.
            if (value != null && value.toLongOrNull() != null) {
                editor.putString(PREFIX + key, value)
            }
        }

        editor.putString(PREFIX + "hidden", if (call.getBoolean("hidden", false) == true) "true" else "false")
        editor.putString(PREFIX + "syncedAt", System.currentTimeMillis().toString())
        editor.apply()

        LedgerWidget.refreshAll(context)

        val result = JSObject()
        result.put("updated", true)
        call.resolve(result)
    }

    /** Called on sign-out: the widget must not keep showing a stranger's money. */
    @PluginMethod
    fun clearWidget(call: PluginCall) {
        val prefs = context.getSharedPreferences(STORE, Context.MODE_PRIVATE)
        val editor = prefs.edit()
        for (key in PAISE_KEYS) editor.remove(PREFIX + key)
        editor.remove(PREFIX + "syncedAt")
        editor.apply()

        LedgerWidget.refreshAll(context)
        call.resolve()
    }
}
