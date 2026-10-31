package com.paperpilot.networking

import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.wifi.WifiInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.util.Log
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.net.Socket

/**
 * Android Native Wi-Fi Direct Manager for PaperPilot.
 *
 * Responsibilities:
 * 1. Monitors Wi-Fi Direct connections via ConnectivityManager.NetworkCallback.
 * 2. Extracts default gateway dynamically from LinkProperties routes (no hardcoding).
 * 3. Binds network sockets to the specific Wi-Fi Direct Network interface,
 *    preventing socket traffic from being misrouted over cellular LTE/5G.
 * 4. Relays network state transitions to local Termux backend at http://127.0.0.1:5000/api/printers/network-event.
 */
class WifiDirectManager(private val context: Context) {
    private val TAG = "WifiDirectManager"
    private val connectivityManager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    private val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    private val httpClient = OkHttpClient()

    private var activeWifiNetwork: Network? = null
    private var currentSsid: String? = null
    private var currentGatewayIp: String? = null

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            super.onAvailable(network)
            val capabilities = connectivityManager.getNetworkCapabilities(network)
            if (capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true) {
                activeWifiNetwork = network
                Log.d(TAG, "Wi-Fi network became available. Binding active interface.")
                inspectNetwork(network)
            }
        }

        override fun onLost(network: Network) {
            super.onLost(network)
            if (activeWifiNetwork == network) {
                activeWifiNetwork = null
                currentSsid = null
                currentGatewayIp = null
                Log.d(TAG, "Wi-Fi network lost.")
                notifyLocalhost(null, null, false)
            }
        }

        override fun onLinkPropertiesChanged(network: Network, linkProperties: LinkProperties) {
            super.onLinkPropertiesChanged(network, linkProperties)
            if (activeWifiNetwork == network) {
                extractGatewayAndNotify(network, linkProperties)
            }
        }
    }

    fun startMonitoring() {
        val request = NetworkRequest.Builder()
            .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
            .build()
        connectivityManager.registerNetworkCallback(request, networkCallback)
        Log.d(TAG, "Registered NetworkCallback for Wi-Fi Direct monitoring.")
    }

    fun stopMonitoring() {
        try {
            connectivityManager.unregisterNetworkCallback(networkCallback)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to unregister network callback: ${e.message}")
        }
    }

    /**
     * Binds a client socket to the active Wi-Fi Direct network interface.
     * Prevents packets from misrouting over cellular data.
     */
    fun bindSocketToWifi(socket: Socket) {
        val net = activeWifiNetwork
        if (net != null) {
            net.bindSocket(socket)
            Log.d(TAG, "Bound socket ${socket.inetAddress} to Wi-Fi Direct network interface.")
        } else {
            Log.w(TAG, "Cannot bind socket: No active Wi-Fi network detected.")
        }
    }

    private fun inspectNetwork(network: Network) {
        val linkProps = connectivityManager.getLinkProperties(network)
        if (linkProps != null) {
            extractGatewayAndNotify(network, linkProps)
        }
    }

    private fun extractGatewayAndNotify(network: Network, linkProperties: LinkProperties) {
        var gateway: String? = null
        for (route in linkProperties.routes) {
            if (route.isDefaultRoute && route.hasGateway()) {
                gateway = route.gateway?.hostAddress
                break
            }
        }

        val wifiInfo: WifiInfo? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            connectivityManager.getNetworkCapabilities(network)?.transportInfo as? WifiInfo
        } else {
            @Suppress("DEPRECATION")
            wifiManager.connectionInfo
        }

        val rawSsid = wifiInfo?.ssid?.replace("\"", "")
        currentSsid = rawSsid
        currentGatewayIp = gateway

        Log.d(TAG, "Detected Network - SSID: $currentSsid, Gateway IP: $currentGatewayIp, Interface: ${linkProperties.interfaceName}")
        notifyLocalhost(currentSsid, currentGatewayIp, true, linkProperties.interfaceName)
    }

    private fun notifyLocalhost(ssid: String?, gatewayIp: String?, isConnected: Boolean, interfaceName: String? = null) {
        val payload = JSONObject().apply {
            put("ssid", ssid ?: "")
            put("gatewayIp", gatewayIp ?: "")
            put("isConnected", isConnected)
            put("interfaceName", interfaceName ?: "")
        }

        val requestBody = payload.toString().toRequestBody("application/json".toMediaTypeOrNull())
        val request = Request.Builder()
            .url("http://127.0.0.1:5000/api/printers/network-event")
            .post(requestBody)
            .build()

        httpClient.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                Log.w(TAG, "Failed to relay network event to Termux backend: ${e.message}")
            }
            override fun onResponse(call: Call, response: Response) {
                response.close()
                Log.d(TAG, "Network event successfully relayed to Termux backend.")
            }
        })
    }
}
