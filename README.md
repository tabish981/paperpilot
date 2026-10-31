# PaperPilot – Smart Automated Printing Assistant
### Hardware Target: HP Smart Tank 580 | Connection: Wi-Fi Direct

PaperPilot is a complete, reliable, local-first Android printing ecosystem that allows users to upload documents from anywhere (via mobile data or offline loopback) and automatically print them once their configured **HP Smart Tank 580** printer becomes reachable over Wi-Fi Direct.

---

## 🚀 Key Architectural Highlights

- **Localhost Loopback Execution**: The Termux Node.js backend runs directly on the same Android phone as the React Native app. Uploads and spooling work 100% offline via `http://127.0.0.1:5000` even when connected to Wi-Fi Direct without internet access.
- **HP Smart Tank 580 Wi-Fi Direct Integration**: Dynamic gateway and IP discovery on subnet `192.168.223.x`, probing IPP port 631 and RAW JetDirect port 9100.
- **Intelligent Print Recovery Engine**: Tracks physical sheet checkpoints instead of naive network socket delivery. Never blindly re-prints completed pages on interruption.
- **PrintBrain Automation**: Automatically starts queue processing when the configured printer Wi-Fi Direct network is detected and ready, respecting battery thresholds.
- **Print Cost Calculator**: Accurately estimates sheets, ink costs, and duplex savings in Indian Rupees (INR ₹).
- **SQLite Engine**: Full ACID transactions with WAL mode (`journal_mode=WAL`), persistent queue locking, and automatic backups.

---

## 📁 Repository Structure

```
paperpilot/
├── mobile/                  # React Native mobile application
│   ├── src/
│   │   ├── components/      # Material Design 3 cards, badges, headers
│   │   ├── navigation/      # Bottom Tab navigation (Home, Docs, Queue, Printers, Settings)
│   │   ├── screens/         # Core application screens
│   │   ├── services/        # Localhost API & Socket.IO client
│   │   ├── store/           # Zustand state management
│   │   └── theme/           # MD3 dark/light palettes
│   └── package.json
├── server/                  # Termux Node.js backend
│   ├── src/
│   │   ├── controllers/     # Document, Queue, Printer, Server, and Cost controllers
│   │   ├── database/        # SQLite connection, WAL mode, migrations (10 tables)
│   │   ├── middleware/      # Error handler, Localhost & Tailscale Auth
│   │   ├── routes/          # Express REST API routes
│   │   ├── services/        # Socket.IO broadcasting service
│   │   └── utils/           # Magic byte file validation, SHA-256 hashing, storage
│   ├── scripts/             # Termux install, wake lock, boot setup scripts
│   └── storage/             # Document and SQLite database storage
├── shared/                  # Monorepo shared TypeScript types, constants, Zod schemas
│   └── src/
├── docs/                    # Architectural and hardware documentation
│   ├── printer-compatibility.md  # HP Smart Tank 580 deep dive
│   ├── architecture.md           # Network topology & system architecture
│   ├── termux-setup.md           # Step-by-step Termux & Android guide
│   ├── api-documentation.md      # Complete REST API & WebSocket reference
│   └── recovery-design.md        # Interrupted-print recovery specification
└── package.json             # Root monorepo workspace configuration
```

---

## 🛠️ Phase 1 Implementation Summary

In **Phase 1**, the entire project foundation was established:
1. **Hardware Compatibility Assessment**: Deep analysis of HP Smart Tank 580 Wi-Fi Direct networking, candidate gateway `192.168.223.1`, IPP port 631, JetDirect port 9100, EWS port 80, PCLm raster requirements, and paper exit sensor feedback.
2. **Monorepo Architecture**: Configured npm workspaces linking `@paperpilot/shared`, `@paperpilot/server`, and `@paperpilot/mobile`.
3. **Shared Contracts**: Common TypeScript types, constants (ports, file signatures, default settings), and Zod validation schemas.
4. **Backend Server & Database**:
   - Express server on port 5000 with Socket.IO integration.
   - SQLite WAL database with migrations creating all 10 core tables: `documents`, `printers`, `print_jobs`, `print_job_checkpoints`, `print_job_events`, `print_settings`, `application_settings`, `notification_logs`, `server_logs`, `device_authorizations`.
   - Magic byte file signature validation (PDF, DOCX, JPEG, PNG) and SHA-256 duplicate detection.
   - Complete REST API endpoints for Documents, Queue, Printers, Server Diagnostics, and INR Cost estimations.
   - Authentication middleware supporting seamless localhost access on-device and Bearer token security for Tailscale remote access.
5. **Termux Scripts & Boot Automation**:
   - `install-termux.sh` for one-command environment setup.
   - `start-server.sh` with `termux-wake-lock` to prevent Android Doze sleep.
   - `termux-boot-setup.sh` for auto-starting the server on phone boot.
6. **Mobile Application**:
   - Modern Material Design 3 interface with dark mode.
   - React Navigation bottom tabs (Home, Docs, Queue, Printers, Settings).
   - Localhost `127.0.0.1:5000` API service and WebSocket listener.
   - Zustand global store for reactive synchronization.
   - Interactive recovery dialog for `NEEDS_CONFIRMATION` interrupted print jobs.

---

## 🚦 Getting Started

### 1. Install Dependencies & Build Shared Module
```bash
npm install
npm run build:shared
```

### 2. Run Backend in Development Mode
```bash
cd server
npm run dev
```
The server will initialize storage directories, run SQLite migrations, seed the default HP Smart Tank 580 profile, and listen at `http://127.0.0.1:5000`.

### 3. Verify Health Endpoint
```bash
curl http://127.0.0.1:5000/api/server/health
```

---

## 🗺️ Roadmap
- [x] **Phase 1**: Project Structure, React Native App, Termux Backend & HP 580 Assessment
- [x] **Phase 2**: Document Management, SQLite Schema, File Signatures & PDF Processing Engine
- [x] **Phase 3**: Persistent Print Queue Worker, Crash Recovery & Concurrency Locking
- [x] **Phase 4**: Wi-Fi Direct Discovery, 5-Stage Network Ladder & HP 580 Native Sockets
- [ ] **Phase 5**: IPP 2.0 & PCLm Printing Protocol Engine
- [ ] **Phase 6**: Android Native Notifications & Foreground Services
- [ ] **Phase 7**: PrintBrain Automation & Sensor-based Recovery
- [ ] **Phase 8**: PDF Processing Tools & INR Cost Calculator Enhancements
- [ ] **Phase 9**: Termux Diagnostics Dashboard & Tailscale Remote Access
- [ ] **Phase 10**: End-to-End Field Testing & Hardening
