package com.paperpilot.printing

import android.content.Context
import android.os.Bundle
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintDocumentInfo
import android.util.Log
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException

/**
 * PaperPilotPrintDocumentAdapter
 *
 * Implements Android's native PrintDocumentAdapter to route PDF documents
 * directly through the Android Print Spooler framework. This provides a system
 * fallback print dialog supporting Mopria, HP Print Service Plugin, and vendor print services.
 */
class PaperPilotPrintDocumentAdapter(
    private val context: Context,
    private val pdfFile: File,
    private val jobName: String
) : PrintDocumentAdapter() {

    companion object {
        private const val TAG = "PaperPilotPrintAdapter"
    }

    override fun onLayout(
        oldAttributes: PrintAttributes?,
        newAttributes: PrintAttributes?,
        cancellationSignal: CancellationSignal?,
        callback: LayoutResultCallback?,
        extras: Bundle?
    ) {
        if (cancellationSignal?.isCanceled == true) {
            callback?.onLayoutCancelled()
            return
        }

        if (!pdfFile.exists() || pdfFile.length() == 0L) {
            callback?.onLayoutFailed("Document file does not exist or is empty: ${pdfFile.absolutePath}")
            return
        }

        val info = PrintDocumentInfo.Builder(jobName)
            .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
            .setPageCount(PrintDocumentInfo.PAGE_COUNT_UNKNOWN)
            .build()

        val changed = newAttributes != oldAttributes
        callback?.onLayoutFinished(info, changed)
        Log.d(TAG, "onLayoutFinished completed for job: $jobName")
    }

    override fun onWrite(
        pages: Array<out PageRange>?,
        destination: ParcelFileDescriptor?,
        cancellationSignal: CancellationSignal?,
        callback: WriteResultCallback?
    ) {
        if (cancellationSignal?.isCanceled == true) {
            callback?.onWriteCancelled()
            return
        }

        if (destination == null) {
            callback?.onWriteFailed("Output destination file descriptor is null")
            return
        }

        var input: FileInputStream? = null
        var output: FileOutputStream? = null

        try {
            input = FileInputStream(pdfFile)
            output = FileOutputStream(destination.fileDescriptor)

            val buffer = ByteArray(16384)
            var bytesRead: Int

            while (input.read(buffer).also { bytesRead = it } >= 0) {
                if (cancellationSignal?.isCanceled == true) {
                    callback?.onWriteCancelled()
                    return
                }
                output.write(buffer, 0, bytesRead)
            }

            output.flush()
            callback?.onWriteFinished(arrayOf(PageRange.ALL_PAGES))
            Log.d(TAG, "onWriteFinished successfully streamed ${pdfFile.length()} bytes to Android Print Spooler")
        } catch (e: IOException) {
            Log.e(TAG, "Failed to stream document to print spooler", e)
            callback?.onWriteFailed("Write IO error: ${e.message}")
        } finally {
            try {
                input?.close()
                output?.close()
            } catch (e: IOException) {
                Log.w(TAG, "Error closing streams", e)
            }
        }
    }
}
