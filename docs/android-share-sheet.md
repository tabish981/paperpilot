# Android Share-Sheet & File Picker Integration Architecture

## 1. Overview
PaperPilot allows users to share any document or image directly from WhatsApp, Telegram, Google Drive, Chrome, or the Android Files app into PaperPilot without opening the app first.

Because the PaperPilot backend runs on the same device at `http://127.0.0.1:5000`, the share-sheet handler can ingest, validate, and spool documents completely offline.

```
+-------------------------------------------------------------+
| Any Android App (WhatsApp, Drive, Files, Chrome, Email)     |
| User clicks "Share" -> Selects "PaperPilot"                 |
+-------------------------------------------------------------+
                              |
                              | Intent.ACTION_SEND / ACTION_SEND_MULTIPLE
                              v
+-------------------------------------------------------------+
| Android Native ShareActivity (Kotlin)                       |
| 1. Extracts Content URI (content://...)                     |
| 2. Resolves filename via OpenableColumns.DISPLAY_NAME       |
| 3. Streams bytes via ContentResolver to temp storage        |
+-------------------------------------------------------------+
                              |
                              | HTTP Multipart POST
                              v
+-------------------------------------------------------------+
| Termux Localhost Backend (http://127.0.0.1:5000)            |
| 1. Inspects Magic Bytes (Validates %PDF, JPG, PNG, DOCX)   |
| 2. Computes SHA-256 (Deduplicates if already exists)        |
| 3. Detects exact page count (pdf-lib)                       |
| 4. Stores in storage/documents/ and registers in SQLite     |
+-------------------------------------------------------------+
                              |
                              | Socket.IO event 'queue:updated'
                              v
+-------------------------------------------------------------+
| React Native UI (PaperPilot App)                            |
| Displays instant notification: "Document added to queue"    |
+-------------------------------------------------------------+
```

---

## 2. Android Manifest Intent Filter Configuration

To register PaperPilot with the Android system share-sheet, `android/app/src/main/AndroidManifest.xml` configures an `activity-alias` or dedicated `ShareActivity`:

```xml
<activity
    android:name=".ShareActivity"
    android:exported="true"
    android:theme="@style/Theme.AppCompat.Translucent.NoTitleBar">
    <intent-filter>
        <action android:name="android.intent.action.SEND" />
        <category android:name="android.intent.category.DEFAULT" />
        <data android:mimeType="application/pdf" />
        <data android:mimeType="image/*" />
        <data android:mimeType="application/vnd.openxmlformats-officedocument.wordprocessingml.document" />
    </intent-filter>
    <intent-filter>
        <action android:name="android.intent.action.SEND_MULTIPLE" />
        <category android:name="android.intent.category.DEFAULT" />
        <data android:mimeType="image/*" />
    </intent-filter>
</activity>
```

---

## 3. Kotlin Stream-to-Localhost Bridge Pattern

The native Android activity receives the `android.net.Uri` and directly uploads to the local loopback server without passing huge byte arrays through the React Native JS bridge:

```kotlin
package com.paperpilot.sharing

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.RequestBody.Companion.asRequestBody
import java.io.File
import java.io.FileOutputStream

class ShareActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (intent?.action == Intent.ACTION_SEND) {
            val uri = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
            if (uri != null) {
                uploadUriToLocalhost(uri)
            }
        }
        finish()
    }

    private fun uploadUriToLocalhost(uri: Uri) {
        val fileName = getFileName(uri) ?: "shared_${System.currentTimeMillis()}.pdf"
        val tempFile = File(cacheDir, fileName)

        contentResolver.openInputStream(uri)?.use { input ->
            FileOutputStream(tempFile).use { output ->
                input.copyTo(output)
            }
        }

        val requestBody = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart(
                "file",
                fileName,
                tempFile.asRequestBody("application/octet-stream".toMediaTypeOrNull())
            )
            .build()

        val request = Request.Builder()
            .url("http://127.0.0.1:5000/api/documents/upload")
            .post(requestBody)
            .build()

        OkHttpClient().newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: java.io.IOException) {
                tempFile.delete()
            }
            override fun onResponse(call: Call, response: Response) {
                tempFile.delete()
                response.close()
            }
        })
    }

    private fun getFileName(uri: Uri): String? {
        var name: String? = null
        contentResolver.query(uri, null, null, null, null)?.use { cursor ->
            val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (cursor.moveToFirst() && nameIndex >= 0) {
                name = cursor.getString(nameIndex)
            }
        }
        return name
    }
}
```

This guarantees instantaneous sharing from any third-party app with zero cloud latency and no memory bottlenecks in JavaScript.
