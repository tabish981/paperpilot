# PaperPilot REST API & WebSocket Documentation

Base URL (Localhost on same Android device): `http://127.0.0.1:5000/api`  
Remote Base URL (via Tailscale VPN): `http://<tailscale-ip>:5000/api`  
Authentication: Localhost requests (`127.0.0.1` / `::1`) are pre-authorized. Remote requests require `Authorization: Bearer <api_token>`.

---

## 1. Documents API (`/api/documents`)

### `POST /api/documents/upload`
Uploads a document via `multipart/form-data`.
- **Validation**: Performs binary magic number verification (`%PDF`, JPEG, PNG, DOCX) and computes SHA-256 hash. Reuses existing document reference if SHA-256 matches.
- **Request**: `file` (binary), `name` (string)
- **Response**: `201 Created` or `200 OK` (if deduplicated)
  ```json
  {
    "message": "Document uploaded and indexed successfully.",
    "isDuplicate": false,
    "document": {
      "id": "c88be238-1a55-4682-bb3f-0cf38c11aa5a",
      "original_name": "SampleDoc.pdf",
      "stored_filename": "c88be238-1a55-4682-bb3f-0cf38c11aa5a.pdf",
      "file_size": 154210,
      "mime_type": "application/pdf",
      "sha256_hash": "a4b2c1...",
      "page_count": 8,
      "created_at": "2026-10-30T20:00:00.000Z"
    }
  }
  ```

### `GET /api/documents`
Lists documents stored on the local phone filesystem.
- **Query Params**:
  - `search` (string): Search string matched against original filename.
  - `filter` (`all` | `pdf` | `image` | `docx` | `processed`): Filters catalog by file category.
  - `sortBy` (`created_at` | `original_name` | `file_size` | `page_count`): Sort column.
  - `sortOrder` (`asc` | `desc`): Direction.

### `GET /api/documents/:id`
Returns document metadata. Add `?download=true` to stream the physical raw file.

### `PATCH /api/documents/:id`
Renames an existing document.
- **Payload**: `{"new_name": "Updated_Assignment.pdf"}`

### `DELETE /api/documents/:id`
Unlinks the physical file from Termux storage and removes its record and associated queue cascades.

### `POST /api/documents/merge`
Merges multiple PDFs into a single continuous file. Preserves original files and stores merged version in `storage/processed/`.
- **Payload**: `{"documentIds": ["uuid-1", "uuid-2"], "outputName": "Merged_Document.pdf"}`

### `POST /api/documents/split`
Splits a PDF by page ranges into discrete sub-documents.
- **Payload**: `{"documentId": "uuid-1", "pageRanges": ["1-3", "4-8"]}`

### `POST /api/documents/extract`
Extracts a specific subset of pages into a standalone PDF.
- **Payload**: `{"documentId": "uuid-1", "pageRange": "1, 3-5", "outputName": "Extracted_Pages.pdf"}`

### `POST /api/documents/image-to-pdf`
Converts one or more JPEG or PNG images into a print-ready A4 or fit-to-image PDF.
- **Payload**: `{"documentIds": ["img-uuid-1"], "outputName": "PrintReady.pdf", "pageSize": "A4"}`

### `POST /api/documents/compress`
Re-packs PDF using object streams, stripping unreferenced blobs.
- **Payload**: `{"documentId": "uuid-1"}`

---

## 2. Print Queue API (`/api/queue`)

### `POST /api/queue`
Enqueues a new print job. Automatically wakes up the queue worker.
- **Payload**:
  ```json
  {
    "document_id": "c88be238-1a55-4682-bb3f-0cf38c11aa5a",
    "printer_id": "hp-smart-tank-580-default",
    "copies": 2,
    "page_range": "1-5",
    "paper_size": "A4",
    "orientation": "portrait",
    "color_mode": "monochrome",
    "duplex_mode": "simplex",
    "priority": 10
  }
  ```

### `GET /api/queue`
Lists the active print queue ordered by execution priority and queue position.
- **Query Params**: `status` (optional filter: `PENDING`, `PRINTING`, `NEEDS_CONFIRMATION`, etc.)
- **Response**:
  ```json
  {
    "queue": [...],
    "count": 5,
    "isQueuePaused": false,
    "activeJobId": "09c86bc5-..."
  }
  ```

### `POST /api/queue/reorder`
Reorders jobs in the queue transactionally.
- **Payload**: `{"jobIdsInOrder": ["job-uuid-2", "job-uuid-1"]}`

### `POST /api/queue/pause-all`
Globally pauses the queue worker. No pending jobs will execute.

### `POST /api/queue/resume-all`
Resumes the global queue worker.

### `POST /api/queue/clear-completed`
Deletes all `COMPLETED` and `CANCELLED` jobs from the database.

### `POST /api/queue/:id/retry`
Resets a `FAILED`, `CANCELLED`, or `INTERRUPTED` job back to `PENDING` status.

### `GET /api/queue/:id`
Retrieves job details, completed checkpoints, and audit event logs.

### `PATCH /api/queue/:id`
Updates job properties (copies, page_range, priority) before printing starts.

### `POST /api/queue/:id/pause`
Pauses execution of the job.

### `POST /api/queue/:id/resume`
Resumes a paused job.

### `POST /api/queue/:id/cancel`
Cancels the job.

### `POST /api/queue/:id/recover`
Recovers an interrupted print job by committing verified printed sheets and setting the resume range.
- **Payload**:
  ```json
  {
    "confirmed_completed_page": 4,
    "resume_from_page": 5,
    "resume_from_copy": 1
  }
  ```

---

## 3. Printers API (`/api/printers`)

### `GET /api/printers`
Lists registered printer profiles.

### `POST /api/printers`
Registers a new printer profile.

### `POST /api/printers/discover`
Performs TCP port interrogation (Port 631 IPP, Port 9100 RAW) across dynamically extracted Wi-Fi Direct gateway IPs and candidate gateways (default: `192.168.223.1`).

### `POST /api/printers/network-event`
Receives network state transitions from Android native `NetworkCallback` when the device joins or disconnects from a Wi-Fi Direct network.
- **Payload**:
  ```json
  {
    "ssid": "DIRECT-HP-SmartTank580",
    "bssid": "aa:bb:cc:dd:ee:ff",
    "gatewayIp": "192.168.223.1",
    "interfaceName": "wlan0",
    "isConnected": true
  }
  ```
- **Response**:
  ```json
  {
    "stage": "AVAILABLE",
    "printerStatus": "AVAILABLE",
    "details": "Printer responded to IPP/RAW handshake and reports ready."
  }
  ```

### `GET /api/printers/:id/status`
Performs physical readiness check (IPP socket handshake + EWS status).
- **Response**:
  ```json
  {
    "id": "hp-smart-tank-580-default",
    "isReady": true,
    "state": "idle",
    "latencyMs": 14,
    "networkStage": "AVAILABLE",
    "connectedSsid": "DIRECT-HP-SmartTank580",
    "gatewayIp": "192.168.223.1"
  }
  ```

### `POST /api/printers/:id/test`
Sends a ping probe and returns connection health and measured latency.

---

## 4. Server API (`/api/server`)

### `GET /api/server/health`
Returns system health, uptime, memory, disk usage, active jobs, and printer connectivity.

### `GET /api/server/status`
Returns CPU architecture, platform, and interface telemetry.

### `GET /api/server/storage`
Returns storage usage breakdown across `documents`, `processed`, and `backups`.

### `POST /api/server/backup`
Creates an atomic copy of `paperpilot.sqlite` in `storage/backups/`.

---

## 5. Cost API (`/api/cost`)

### `POST /api/cost/estimate`
Computes total impressions, sheets needed, ink cost, paper cost, and duplex savings in INR (₹).
- **Payload**: `{"page_count": 20, "copies": 2, "color_mode": "monochrome", "duplex_mode": "manual_duplex"}`
