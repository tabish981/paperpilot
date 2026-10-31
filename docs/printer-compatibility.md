# Hardware Compatibility Assessment: HP Smart Tank 580 (All-in-One Series)

## 1. Executive Summary & Hardware Profile

The **HP Smart Tank 580 All-in-One** is an entry-level thermal inkjet wireless printer designed for micro-office and domestic high-volume, low-cost printing. This assessment establishes its architectural parameters, network behavior, supported protocols, PDLs (Page Description Languages), and the boundaries of physical print-progress feedback for PaperPilot.

### Key Hardware Specifications
- **Model**: HP Smart Tank 580 All-in-One Printer (1F3Y2A)
- **Print Technology**: HP Thermal Inkjet (Continuous Ink Supply System - CISS)
- **Engine Resolution**: Up to 1200 x 1200 rendered dpi (Black); up to 4800 x 1200 optimized dpi on HP Advanced Photo Paper (Color)
- **Processor & Memory**: 980 MHz SoC; 64 MB Integrated DDR1 RAM
- **Print Speed**: Up to 12 ppm (Black, ISO); up to 5 ppm (Color, ISO); Draft up to 22 ppm (Black) / 16 ppm (Color)
- **Duplexing**: **Manual duplex only** (Driver/Application assisted reverse-feed; no automatic physical duplex unit)
- **Connectivity**:
  - High-Speed USB 2.0
  - Wi-Fi 802.11b/g/n (2.4 GHz single-band, or dual-band 2.4/5GHz depending on specific SKU revision)
  - **Wi-Fi Direct** (SoftAP / WFD P2P mode)
  - Bluetooth Low Energy (BLE - for out-of-box onboarding / provisioning only)

---

## 2. Wi-Fi Direct Network Topology & Addressing

### 2.1 SoftAP vs. Wi-Fi Direct P2P Group Owner
HP Smart Tank 580 implements Wi-Fi Direct via two modes configurable in its Embedded Web Server (EWS):
1. **Automatic / WFD Push Button (WPS-PBC) or PIN**: The printer acts as a P2P Group Owner (GO).
2. **Wi-Fi Direct Passphrase / SoftAP**: The printer acts as an independent Wi-Fi Access Point (SSID typically formatted as `DIRECT-xx-HP Smart Tank 580` or `DIRECT-[2 alphanumeric]-HP Smart Tank 580`).

### 2.2 Addressing Dynamics & Subnets
- **Default DHCP Server**: When acting as Wi-Fi Direct Group Owner / SoftAP, the HP Smart Tank 580 runs a built-in DHCP server.
- **Candidate Gateway Address**: Typically assigns itself `192.168.223.1` (netmask `255.255.255.0`), assigning the connecting mobile device an IP in the `192.168.223.100` – `192.168.223.250` range.
- **CRITICAL ARCHITECTURAL RULE FOR PAPERPILOT**: 
  - `192.168.223.1` must **never** be hardcoded as an immutable IP.
  - The Android client dynamically extracts the default gateway from Android `LinkProperties.getRoutes()` on the Wi-Fi Direct `Network` object.
  - Furthermore, if the printer is joined to an existing infrastructure LAN (e.g. home router), its IP address will be dynamically assigned via DHCP on that subnet (e.g. `192.168.1.x` or `10.0.0.x`).
  - Therefore, discovery must combine:
    1. Gateway interrogation on the active Wi-Fi Direct interface.
    2. mDNS / DNS-SD probing (`_ipp._tcp.local`, `_pdl-datastream._tcp.local`, `_printer._tcp.local`, `_http._tcp.local`).
    3. Fallback targeted port probing on candidate subnet gateways (Ports 631, 9100, 80).

---

## 3. Protocol Stack & Port Analysis

| Port | Protocol / Service | Advertised Service Name | HP Smart Tank 580 Support | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **631** | **IPP / IPPS (2.0)** | `_ipp._tcp.local`, `_ipps._tcp.local` | **Primary Supported** | Standard for Android Mopria & AirPrint. Exposes job submission and queue attributes. |
| **9100** | **RAW / JetDirect / AppSocket** | `_pdl-datastream._tcp.local` | **Supported** | Bidirectional TCP stream for raw byte transmission (PCLm / PCL3GUI / URF). |
| **80 / 443** | **HTTP / HTTPS EWS** | `_http._tcp.local` | **Supported** | Embedded Web Server (LED/cartridge levels, Wi-Fi Direct status, network config, XML device status). |
| **5353** | **mDNS / DNS-SD** | Multicast UDP | **Supported** | Used for zeroconf discovery of AirPrint / Mopria / IPP capabilities. |
| **3702** | **WS-Discovery** | UDP | **Supported** | Web Services on Devices (used by Windows WSD; accessible on Linux/Android). |
| **8080 / 8289**| **HP LEDM / eSCL** | `_uscan._tcp.local` | **Supported** | eSCL / AirScan for flatbed scanner functions. |

---

## 4. Supported Page Description Languages (PDLs) & Raster Formats

The HP Smart Tank 580 SoC has only **64 MB RAM** and lacks a dedicated PostScript or native PDF rasterizer hardware RIP (Raster Image Processor).

### Supported PDLs
1. **HP PCLm / PCLmS (PCL Micro)**:
   - Profile: RFC 2083 raster format encapsulated into PDF-like syntax (flate / JPEG compressed strips).
   - This is the standard language used by Android Mopria and Apple AirPrint for low-memory devices.
2. **HP PCL 3 GUI**:
   - Raster-compressed proprietary format derived from HP PCL 3. Requires host-side rendering to 300/600/1200 DPI bitmap before transmission.
3. **Apple URF (Universal Raster Format)**:
   - Single-bit or 8-bit per channel uncompressed/RLE raster pages used over AirPrint IPP.
4. **Direct PDF / PostScript Submission**:
   - **UNSUPPORTED NATIVELY**: Direct POST of raw standard PDF binary to port 9100 or standard LPD on HP Smart Tank 580 will either be ignored or cause garbage output.
   - **MANDATORY ENGINE REQUIREMENT**: The PaperPilot document pipeline (or Android Print Framework via Mopria / PrintService) must rasterize or convert PDFs into **PCLm** or **URF** prior to direct network transmission, OR delegate to the Android Print Framework via Android `PrintDocumentAdapter`.

---

## 5. Job Status & Page Progress Reporting: Reality vs. Assumptions

### 5.1 IPP `get-job-attributes` Capabilities
When querying `http://<printer-ip>:631/ipp/print`:
- **Supported IPP operations**:
  - `Print-Job` (0x0002)
  - `Validate-Job` (0x0004)
  - `Get-Printer-Attributes` (0x000B)
  - `Get-Jobs` (0x000A)
  - `Get-Job-Attributes` (0x0009)
  - `Cancel-Job` (0x0008)

### 5.2 The Critical Pitfall: Network Spooling vs. Mechanical Printing
1. **Memory Buffer Drain**:
   - For a 10-page document submitted over IPP or Port 9100, the printer's 64 MB RAM accepts the entire PCLm stream across the network in 2 to 5 seconds.
   - The TCP connection closes or transitions `job-state` from `processing` to `completed` **before the printhead finishes moving across page 2**.
2. **Page Counter Granularity (`job-impressions-completed`)**:
   - In entry-level HP Smart Tank firmware, `job-impressions-completed` or `job-media-sheets-completed` updates **only when the physical sheet feed sensor (PE / Page Exit flag) triggers**.
   - If paper jams or ink exhausts on page 4 of a 10-page spool:
     - The printer state transitions to `marker-supply-empty-warning` or `media-jam`.
     - But if power is cut or Wi-Fi Direct connection drops abruptly during printing, the printer's volatile RAM loses the unprinted buffer entirely.
     - Upon reconnecting, `Get-Job-Attributes` for the previous volatile job returns `job-not-found` (HTTP/IPP 0x0406 client-error-not-found) because jobs are not persisted across printer power cycles or Wi-Fi Direct resets.

### 5.3 Architectural Invariants for PaperPilot Recovery Engine
1. **Never equate socket closure or HTTP 200 / IPP successful-ok with physical print completion**.
2. **Checkpoint Granularity**:
   - Physical page verification must be polled from IPP attributes during active `processing` states (`job-impressions-completed`).
   - If the connection drops while the printer was in `processing` and the printer later reports `job-not-found` or fails to report subsequent sheet completions:
     - The job status **MUST** transition to `NEEDS_CONFIRMATION`.
     - The UI presents the user with the last verified physical sheet (e.g. Page 3) and prompts: *"PaperPilot detected an interruption. Did page 3 print cleanly? Resume from Page 4?"*
3. **Multi-Copy Optimization**:
   - For multi-copy print jobs (e.g., 5 copies of a 10-page document), PaperPilot submits copies as **discrete sequential sub-jobs** or checkpoints each copy boundary. If Copy 1 finishes and Copy 2 fails at Page 5, Copy 1 is safely committed to the database as `COMPLETED`. Copy 2 is split into a resumed slice starting from Page 6.
