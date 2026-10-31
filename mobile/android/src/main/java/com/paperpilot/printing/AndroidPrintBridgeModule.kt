package com.paperpilot.printing

import android.content.Context
import android.print.PrintAttributes
import android.print.PrintManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

/**
 * AndroidPrintBridgeModule
 *
 * Exposes Android PrintManager to React Native, launching the standard
 * Android print UI dialog for any PDF document with system print service plugins.
 */
class AndroidPrintBridgeModule(
    private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String {
        return "AndroidPrintBridge"
    }

    @ReactMethod
    fun printDocument(filePath: String, jobName: String, promise: Promise) {
        val activity = currentActivity
        if (activity == null) {
            promise.reject("ACTIVITY_NULL", "Current Android activity is null")
            return
        }

        val file = File(filePath)
        if (!file.exists() || !file.canRead()) {
            promise.reject("FILE_NOT_FOUND", "Specified document file cannot be read: $filePath")
            return
        }

        activity.runOnUiThread {
            try {
                val printManager = activity.getSystemService(Context.PRINT_SERVICE) as? PrintManager
                if (printManager == null) {
                    promise.reject("PRINT_MANAGER_UNAVAILABLE", "Android PrintManager service is not available on this device")
                    return@runOnUiThread
                }

                val adapter = PaperPilotPrintDocumentAdapter(reactContext, file, jobName)
                val printJob = printManager.print(
                    jobName,
                    adapter,
                    PrintAttributes.Builder().build()
                )

                if (printJob != null) {
                    promise.resolve(printJob.id?.toString() ?: "SYSTEM_PRINT_JOB_STARTED")
                } else {
                    promise.reject("PRINT_FAILED", "PrintManager returned null job handle")
                }
            } catch (e: Exception) {
                promise.reject("PRINT_EXCEPTION", "Error launching Android print service: ${e.message}", e)
            }
        }
    }
}
