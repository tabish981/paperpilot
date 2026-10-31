# Termux Server Setup & Android Service Integration Guide

## 1. Overview
PaperPilot runs its high-performance Node.js backend and SQLite database directly on your Android phone using **Termux**. This ensures 100% offline document handling, zero cloud dependency, and seamless local communication with the React Native UI over `http://127.0.0.1:5000`.

---

## 2. Prerequisites
1. **Termux (F-Droid version)**: Download and install Termux from [F-Droid](https://f-droid.org/packages/com.termux/). *Do NOT use Google Play Store Termux (it is deprecated).*
2. **Termux:Boot (Optional, for auto-start)**: Download from [F-Droid](https://f-droid.org/packages/com.termux.boot/).
3. **Termux:API (Optional, for battery inspection)**: Download from [F-Droid](https://f-droid.org/packages/com.termux.api/).

---

## 3. Installation Steps

### Step 1: Open Termux and Run the Installer
In Termux, navigate to the PaperPilot project directory or clone it:
```bash
cd ~/PaperPilot
chmod +x server/scripts/*.sh
./server/scripts/install-termux.sh
```

### Step 2: Grant Android Storage Permission
When prompted by Android, grant Termux storage access to read and write files to your device.

### Step 3: Prevent Android Doze from Killing the Process
Modern Android aggressively kills background processes. To prevent Termux from being terminated:
1. Long press **Termux icon** -> **App Info**.
2. Go to **Battery** -> select **"Unrestricted"** (No battery restrictions).
3. Disable **"Pause app activity if unused"**.
4. In Termux, run:
   ```bash
   termux-wake-lock
   ```
   (This acquires an Android CPU wake lock so tasks proceed even when the phone screen turns off).

---

## 4. Starting the Server Manually
```bash
cd ~/PaperPilot/server
./scripts/start-server.sh
```
Output:
```
----------------------------------------------------
   PaperPilot – Local Android Printing Server       
   Hardware Target: HP Smart Tank 580 (Wi-Fi Direct)
----------------------------------------------------
[Storage] Initialized storage paths
[DB] Connected to SQLite database
[Migrations] Database schema verified
[Socket.IO] WebSocket server initialized
[Server] Listening on http://0.0.0.0:5000
[Server] Local Android loopback accessible at http://127.0.0.1:5000
```

---

## 5. Setting up Auto-Start on Boot (Termux:Boot)
To have PaperPilot start automatically whenever your phone restarts:
```bash
cd ~/PaperPilot
./server/scripts/termux-boot-setup.sh
```
Then launch the **Termux:Boot** application once from your launcher to register the boot receiver.
