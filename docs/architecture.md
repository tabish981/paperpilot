# PaperPilot System Architecture

## 1. High-Level System Overview

PaperPilot is a local-first, smart automated printing ecosystem running directly on an Android smartphone. It bridges mobile document handling with physical printing hardware (specifically the **HP Smart Tank 580** over Wi-Fi Direct) without relying on third-party cloud services or internet connectivity.

```
+-----------------------------------------------------------------------------------+
|                            Android Smartphone                                     |
|                                                                                   |
|  +-------------------------------------+   HTTP / REST / WebSocket               |
|  |     PaperPilot React Native UI      | <========================+               |
|  |  - Document Picker & Preview        |   (127.0.0.1:5000)      |               |
|  |  - Persistent Print Queue View      |                         |               |
|  |  - Printer Management & Cost Calc   |                         |               |
|  |  - Recovery & Checkpoint Review     |                         |               |
|  +------------------+------------------+                         |               |
|                     |                                            |               |
|                     | Native Module IPC                          v               |
|  +------------------v------------------+        +--------------------------------+
|  | Android Native Services (Kotlin)    |        | Termux Local Node.js Backend   |
|  | - NetworkCallback (Wi-Fi Direct)    |        | - Express API Server           |
|  | - Socket Binding to Wi-Fi Interface |        | - SQLite Engine (WAL mode)     |
|  | - Android Notification Manager      |        | - PrintBrain Automation Engine |
|  | - Android Print Framework Bridge    |        | - Print Recovery Engine        |
|  +-------------------------------------+        | - Document Processing (PDF/IMG)|
|                                                 | - Termux Storage (/storage)    |
|                                                 +---------------+----------------+
+-----------------------------------------------------------------|-----------------+
                                                                  |
                                                                  | Wi-Fi Direct
                                                                  | (192.168.223.x / dynamic)
                                                                  | IPP Port 631 / RAW Port 9100
                                                                  v
                                              +-------------------------------------+
                                              |       HP Smart Tank 580             |
                                              | - Wi-Fi Direct P2P Group Owner      |
                                              | - Embedded Web Server (Port 80)     |
                                              | - IPP 2.0 Spooler (Port 631)        |
                                              | - Paper Exit Sensor & Page Counter  |
                                              +-------------------------------------+
```

---

## 2. Network Routing & Localhost Guarantees

### 2.1 The "Offline Wi-Fi Direct + Local Server" Problem
When an Android smartphone joins the HP Smart Tank 580's Wi-Fi Direct network:
1. The Wi-Fi interface connects to an AP that has **NO internet access** (no WAN upstream route).
2. Android's `ConnectivityManager` detects `NET_CAPABILITY_VALIDATED` is missing on Wi-Fi and may attempt to keep mobile data (Cellular LTE/5G) active for internet traffic.
3. **Localhost Communication (`127.0.0.1`)**:
   - The loopback interface (`lo`) on Android's Linux kernel operates completely independently of physical network routing tables.
   - Any HTTP request or WebSocket connection from the React Native app to `127.0.0.1:5000` travels strictly within the kernel IPC loopback stack.
   - It succeeds with 0 ms roundtrip whether the device is:
     - On 5G cellular with Wi-Fi off.
     - Connected to Wi-Fi Direct with no internet.
     - In complete Airplane Mode.
4. **Printer Interfacing through Specific Network Bindings**:
   - To send IPP packets to the printer IP (e.g., `192.168.223.1`), sockets must be routed through the specific network bound to the Wi-Fi Direct interface (`Network.bindSocket()`), ensuring packets are not misrouted to cellular data.

---

## 3. Core Subsystems

### 3.1 Document Management
- **File Validation**: Multi-tier validation checking magic bytes / signatures (`%PDF-`, `\xFF\xD8\xFF` for JPEG, `\x89PNG` for PNG, `PK\x03\x04` for DOCX/ZIP).
- **Storage Strategy**: Files stored under dedicated Termux filesystem path (`$HOME/paperpilot/storage/documents/`). Raw database stores only metadata, SHA-256 hashes, page counts, and disk references.
- **Deduplication**: SHA-256 content hashes prevent duplicate document storage.

### 3.2 Persistent Print Queue
- **State Machine**:
  `PENDING` -> `WAITING_FOR_PRINTER` -> `VALIDATING` -> `SUBMITTED` -> `PRINTING` -> `COMPLETED`
  Failure / Pause branches: `PAUSED`, `INTERRUPTED`, `FAILED`, `CANCELLED`, `NEEDS_CONFIRMATION`.
- **Concurrency & Locking**: Persistent SQLite queue worker uses database transactions and `BEGIN IMMEDIATE` row-locking to ensure single-job sequential processing.

### 3.3 PrintBrain Automation Engine
- Runs as an active worker loop within the local Termux Node.js service.
- Evaluates:
  1. Battery state (pauses automated dispatch if battery < configurable threshold, e.g. 15%, unless charging).
  2. Active network interface (checks if connected SSID / Wi-Fi Direct match registered printer profile).
  3. Printer readiness (verifies socket reachability + IPP printer-state == `idle` / `3`).
  4. Automatic sequential dispatch of eligible queued jobs.

### 3.4 Intelligent Print Recovery Engine
- Tracks multi-copy jobs as granular units: `(copy_index, page_number)`.
- Records persistent checkpoints in `print_job_checkpoints` upon each verified sheet increment.
- Handles unexpected drops:
  - If a job spooled 20 pages, but connection dropped after Page 4 was physically confirmed:
    - If printer reports `job-not-found` on reconnect, status flips to `NEEDS_CONFIRMATION`.
    - User can verify: "Page 4 printed. Resume from Page 5."
    - Engine creates a synthetic resumption job with page range `5-20` for remaining copies, preventing double-billing or paper waste.

---

## 4. Database Schema Overview

The SQLite database uses WAL mode (`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;`):
1. `documents`: File catalog, physical path, MIME, SHA-256, page count, file size.
2. `printers`: Profile configs, MAC/BSSID, IP, port, protocol, paper capabilities, is_default.
3. `print_jobs`: High-level job specifications (document reference, printer reference, copies, page range, color mode, duplex, priority, status).
4. `print_job_checkpoints`: Granular copy & page checkpoints with verified timestamps.
5. `print_job_events`: Audit trail for state transitions and diagnostic telemetry.
6. `print_settings`: Global print defaults (margins, paper size, color defaults).
7. `application_settings`: Automation toggles, battery limits, retry intervals, polling timers.
8. `notification_logs`: History of generated alerts and push triggers.
9. `server_logs`: Server runtime logs, errors, and performance metrics.
10. `device_authorizations`: Auth tokens and permissions for remote access (Tailscale / LAN).
