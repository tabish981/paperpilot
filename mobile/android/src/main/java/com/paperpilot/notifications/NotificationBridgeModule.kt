package com.paperpilot.notifications

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * PaperPilot Native Android Notification Bridge
 *
 * Implements Android O+ Notification Channels and foreground telemetry:
 * 1. printer_status (Ongoing, low priority)
 * 2. print_progress (High priority, live progress bar with sheet count)
 * 3. alerts (Max priority, heads-up, vibration for jams, door open, paper empty, manual duplex prompt)
 */
class NotificationBridgeModule(
    private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val CHANNEL_PRINTER_STATUS = "printer_status"
        const val CHANNEL_PRINT_PROGRESS = "print_progress"
        const val CHANNEL_ALERTS = "paperpilot_alerts"

        const val NOTIFICATION_ID_PROGRESS = 1001
        const val NOTIFICATION_ID_STATUS = 1002
        const val NOTIFICATION_ID_ALERT = 1003
    }

    override fun getName(): String = "NotificationBridge"

    init {
        createChannels()
    }

    private fun createChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val notificationManager =
                reactContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

            // 1. Printer Status Channel (Low importance)
            val statusChannel = NotificationChannel(
                CHANNEL_PRINTER_STATUS,
                "Printer Status & Wi-Fi Direct",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Ongoing printer connectivity and Wi-Fi Direct ladder state"
                setShowBadge(false)
            }

            // 2. Print Progress Channel (High importance)
            val progressChannel = NotificationChannel(
                CHANNEL_PRINT_PROGRESS,
                "Print Progress",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Live sheet-by-sheet printing progress and copy status"
                setShowBadge(true)
                enableVibration(false)
            }

            // 3. Alerts Channel (Max importance)
            val alertChannel = NotificationChannel(
                CHANNEL_ALERTS,
                "Critical Printer Alerts",
                NotificationManager.IMPORTANCE_MAX
            ).apply {
                description = "Door open, out of paper, paper jam, manual duplex re-feed"
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 250, 150, 250)
            }

            notificationManager.createNotificationChannels(listOf(statusChannel, progressChannel, alertChannel))
        }
    }

    @ReactMethod
    fun showProgressNotification(
        jobId: String,
        title: String,
        currentSheet: Int,
        totalSheets: Int,
        isDuplexAwaiting: Boolean,
        promise: Promise
    ) {
        try {
            val notificationManager = NotificationManagerCompat.from(reactContext)

            val builder = NotificationCompat.Builder(reactContext, CHANNEL_PRINT_PROGRESS)
                .setSmallIcon(android.R.drawable.ic_menu_agenda)
                .setContentTitle(title)
                .setOnlyAlertOnce(true)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)

            if (isDuplexAwaiting) {
              builder.setContentText("Step 1 Odd pages completed. Re-insert paper into tray.")
                  .setProgress(0, 0, false)
            } else if (totalSheets > 0) {
              builder.setContentText("Printing sheet $currentSheet of $totalSheets")
                  .setProgress(totalSheets, currentSheet, false)
            } else {
              builder.setContentText("Sending raster stream to HP Smart Tank 580...")
                  .setProgress(0, 0, true)
            }

            notificationManager.notify(NOTIFICATION_ID_PROGRESS, builder.build())
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("NOTIFICATION_ERROR", e.message)
        }
    }

    @ReactMethod
    fun showAlertNotification(
        title: String,
        message: String,
        alertType: String,
        promise: Promise
    ) {
        try {
            val notificationManager = NotificationManagerCompat.from(reactContext)

            val builder = NotificationCompat.Builder(reactContext, CHANNEL_ALERTS)
                .setSmallIcon(android.R.drawable.stat_notify_error)
                .setContentTitle(title)
                .setContentText(message)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setAutoCancel(true)
                .setStyle(NotificationCompat.BigTextStyle().bigText(message))

            notificationManager.notify(NOTIFICATION_ID_ALERT, builder.build())
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ALERT_NOTIFICATION_ERROR", e.message)
        }
    }

    @ReactMethod
    fun cancelProgressNotification(promise: Promise) {
        try {
            val notificationManager = NotificationManagerCompat.from(reactContext)
            notificationManager.cancel(NOTIFICATION_ID_PROGRESS)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("CANCEL_ERROR", e.message)
        }
    }
}
