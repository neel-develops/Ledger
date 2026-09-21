package `in`.neel.ledger

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.net.Uri
import android.os.Bundle
import android.widget.RemoteViews
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.abs

/**
 * The home-screen widget.
 *
 * It reads figures the app has already computed and stored, rather than
 * talking to the API itself. Two reasons, both about being honest:
 *
 *  - There is exactly one implementation of the accounting. The widget cannot
 *    drift from the app, because it does no arithmetic of its own.
 *  - It never has to hold a session. Nothing sensitive leaves the app process.
 *
 * The consequence is that the widget shows the last known position and says
 * when that was. It never shows a number it cannot stand behind, and when it
 * has nothing it says so instead of rendering a zero.
 */
class LedgerWidget : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        ids.forEach { render(context, manager, it) }
    }

    override fun onAppWidgetOptionsChanged(
        context: Context,
        manager: AppWidgetManager,
        id: Int,
        newOptions: Bundle,
    ) {
        render(context, manager, id)
    }

    companion object {
        /** Capacitor's Preferences plugin writes here, with this key prefix. */
        private const val STORE = "CapacitorStorage"
        private const val PREFIX = "ledger.widget."

        /** Ask Android to redraw every placed widget. Called after the app syncs. */
        fun refreshAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(
                android.content.ComponentName(context, LedgerWidget::class.java),
            )
            ids.forEach { render(context, manager, it) }
        }

        private fun render(context: Context, manager: AppWidgetManager, id: Int) {
            val prefs: SharedPreferences = context.getSharedPreferences(STORE, Context.MODE_PRIVATE)
            val hasData = prefs.contains(PREFIX + "netPosition")

            val options = manager.getAppWidgetOptions(id)
            val minHeight = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0)
            val layout = if (minHeight >= 110) R.layout.widget_medium else R.layout.widget_small

            val views = RemoteViews(context.packageName, layout)

            if (!hasData) {
                // Nothing synced yet. Say that, rather than implying zero rupees.
                views.setTextViewText(R.id.widget_amount, "—")
                views.setTextViewText(R.id.widget_caption, "Open Ledger to sync")
                if (layout == R.layout.widget_medium) {
                    views.setTextViewText(R.id.widget_owed_value, "—")
                    views.setTextViewText(R.id.widget_owing_value, "—")
                    views.setTextViewText(R.id.widget_cash_value, "—")
                    views.setTextViewText(R.id.widget_digital_value, "—")
                }
            } else {
                val hidden = prefs.getString(PREFIX + "hidden", "false") == "true"
                fun show(key: String): String =
                    if (hidden) "••••" else formatPaise(readPaise(prefs, key))

                views.setTextViewText(R.id.widget_amount, show("ownedMoney"))
                views.setTextViewText(R.id.widget_caption, caption(prefs))

                if (layout == R.layout.widget_medium) {
                    views.setTextViewText(R.id.widget_owed_value, show("owedToMe"))
                    views.setTextViewText(R.id.widget_owing_value, show("iOwe"))
                    views.setTextViewText(R.id.widget_cash_value, show("cash"))
                    views.setTextViewText(R.id.widget_digital_value, show("digital"))
                }
            }

            views.setOnClickPendingIntent(R.id.widget_root, open(context, "/", id))
            if (layout == R.layout.widget_medium) {
                views.setOnClickPendingIntent(R.id.widget_add_expense, open(context, "/?add=expense", id + 1000))
                views.setOnClickPendingIntent(R.id.widget_add_received, open(context, "/?add=income", id + 2000))
                views.setOnClickPendingIntent(R.id.widget_add_transfer, open(context, "/?add=transfer", id + 3000))
            }

            manager.updateAppWidget(id, views)
        }

        private fun caption(prefs: SharedPreferences): String {
            val synced = prefs.getString(PREFIX + "syncedAt", null)?.toLongOrNull()
                ?: return "Total money"
            val age = System.currentTimeMillis() - synced
            return when {
                age < 5 * 60_000L -> "Total money"
                age < 60 * 60_000L -> "Total money · ${age / 60_000} min ago"
                age < 24 * 60 * 60_000L -> "Total money · ${age / 3_600_000} h ago"
                else -> "Total money · " + SimpleDateFormat("d MMM", Locale.getDefault()).format(Date(synced))
            }
        }

        private fun readPaise(prefs: SharedPreferences, key: String): Long =
            prefs.getString(PREFIX + key, null)?.toLongOrNull() ?: 0L

        private fun open(context: Context, path: String, requestCode: Int): PendingIntent {
            val intent = Intent(context, MainActivity::class.java).apply {
                action = Intent.ACTION_VIEW
                data = Uri.parse("ledger://open$path")
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            return PendingIntent.getActivity(
                context,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }

        /**
         * Integer paise to a grouped rupee string, in the Indian convention:
         * 12345678 -> "₹1,23,456.78" and whole amounts drop the paise.
         *
         * Deliberately hand-written rather than left to a locale formatter, so
         * the widget and the app can never disagree about how money looks.
         */
        fun formatPaise(paise: Long): String {
            val negative = paise < 0
            val value = abs(paise)
            val whole = value / 100
            val fraction = (value % 100).toInt()

            val digits = whole.toString()
            val grouped = if (digits.length <= 3) {
                digits
            } else {
                val last3 = digits.substring(digits.length - 3)
                val rest = digits.substring(0, digits.length - 3)
                val builder = StringBuilder()
                var count = 0
                for (i in rest.length - 1 downTo 0) {
                    builder.append(rest[i])
                    count++
                    if (count % 2 == 0 && i != 0) builder.append(',')
                }
                builder.reverse().toString() + "," + last3
            }

            val tail = if (fraction == 0) "" else String.format(Locale.US, ".%02d", fraction)
            return (if (negative) "-₹" else "₹") + grouped + tail
        }
    }
}
