# Android Wi-Fi Direct Networking & Native Socket Binding

## 1. The Android Dual-Interface Routing Challenge

When an Android phone connects to the **HP Smart Tank 580** over Wi-Fi Direct:
1. The Wi-Fi interface connects to the printer's SoftAP/P2P Group Owner (`DIRECT-xx-HP Smart Tank 580`).
2. This network has **no internet access** (no WAN upstream route).
3. Android's `ConnectivityManager` marks the Wi-Fi connection as `NET_CAPABILITY_NOT_VALIDATED` (no internet connectivity).
4. **The Routing Hazard**:
   - If cellular data (4G/5G) is enabled, Android automatically routes all default socket traffic over cellular to preserve internet access.
   - If an application naively creates a standard `Socket("192.168.223.1", 631)`, the kernel routing table may try to send the packets out the cellular interface, resulting in `ENETUNREACH` or `ETIMEDOUT`.
5. **The Solution**:
   - PaperPilot uses Android's `NetworkCallback` to capture the specific `android.net.Network` instance assigned to the Wi-Fi Direct connection.
   - Any printer communication explicitly invokes `network.bindSocket(socket)`, binding the socket file descriptor to the Wi-Fi physical interface (`wlan0` or `p2p-wlan0-x`).

---

## 2. Dynamic Gateway Extraction vs. Hardcoded IPs

1. **Never Hardcode `192.168.223.1`**:
   - While entry-level HP Smart Tank firmware commonly defaults to `192.168.223.1` when operating as Group Owner, firmware revisions or existing Wi-Fi Direct groups may assign different addresses (e.g. `192.168.49.1` or DHCP on local LAN `192.168.1.x`).
2. **Dynamic Route Discovery**:
   - In Kotlin, on `onLinkPropertiesChanged(network, linkProperties)`:
     ```kotlin
     for (route in linkProperties.routes) {
         if (route.isDefaultRoute && route.hasGateway()) {
             val gatewayIp = route.gateway?.hostAddress
             // Send discovered gateway to Termux backend
         }
     }
     ```
3. **Automatic Loopback Posting**:
   - The native Android layer immediately notifies the Termux backend at `http://127.0.0.1:5000/api/printers/network-event` with the discovered gateway IP and SSID.

---

## 3. The 5-Stage Network State Ladder

PaperPilot never treats "connected to Wi-Fi" as equivalent to "printer ready". The system transitions through 5 strictly validated stages:

```
+---------------------+
| 1. DISCONNECTED     | Phone is not on the printer Wi-Fi Direct network
+----------+----------+
           | User or Auto-Join connects to SSID: DIRECT-xx-HP Smart Tank 580
           v
+---------------------+
| 2. NETWORK_DETECTED | Android NetworkCallback detects printer Wi-Fi Direct SSID
+----------+----------+
           | Native layer extracts Gateway IP from LinkProperties
           v
+---------------------+
| 3. IP_REACHABLE     | TCP SYN handshake succeeds to printer IP
+----------+----------+
           | Port 631 (IPP) or Port 9100 (RAW) handshake verified
           v
+---------------------+
| 4. PROTO_AVAILABLE  | IPP attributes accessible over port 631
+----------+----------+
           | EWS / IPP query confirms: State is 'idle', paper loaded, ink available
           v
+---------------------+
| 5. PRINTER_READY    | Configured printer is verified and ready for automatic queue execution
+---------------------+
```
