/**
 * WifiDirectScreen
 * Step-by-step guide for connecting an Android phone to the
 * HP Smart Tank 580 Wi-Fi Direct hotspot and verifying the
 * printer is reachable via IPP from the app.
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { DarkTheme } from '../theme/colors';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { api } from '../services/api';

const WIFI_DIRECT_IP = '192.168.223.1';
const WIFI_DIRECT_PORT = 631;

const STEPS = [
  {
    id: '01',
    title: 'Enable Wi-Fi Direct on Printer',
    body:
      'Press the Wireless button on the HP Smart Tank 580 panel (hold 3 seconds) until the Wi-Fi Direct LED blinks. The printer creates its own hotspot (HP-Print-XX-Smart Tank 580).',
    icon: '🖨',
  },
  {
    id: '02',
    title: 'Connect Android to Printer Hotspot',
    body:
      'Open Android Settings → Wi-Fi → scan for "HP-Print-XX-Smart Tank 580". Tap to connect. Password is printed on the Wi-Fi Direct info page (hold Wireless + Cancel buttons 3 sec).',
    icon: '📶',
  },
  {
    id: '03',
    title: 'Verify IP Address',
    body: `The printer is always reachable at ${WIFI_DIRECT_IP}:${WIFI_DIRECT_PORT} over Wi-Fi Direct. PaperPilot uses this IP for IPP/PCLm job submission. No router required.`,
    icon: '🔒',
  },
  {
    id: '04',
    title: 'Start Termux Backend',
    body:
      'In Termux, run: node /storage/emulated/0/PaperPilot/server/dist/index.js\nThe server binds to 127.0.0.1:5000. PaperPilot mobile connects to this local server, which then talks to the printer.',
    icon: '⚙',
    isCode: true,
    codeSnippet: 'node ~/PaperPilot/server/dist/index.js',
  },
  {
    id: '05',
    title: 'Discover & Register Printer',
    body:
      'Go to the Printers tab and tap "Discover". The scanner will find the HP Smart Tank 580 at 192.168.223.1 and register it automatically. Or tap "Register HP Smart Tank 580" below.',
    icon: '🔍',
  },
];

export const WifiDirectScreen: React.FC = () => {
  const [activeStep, setActiveStep] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    latencyMs?: number;
  } | null>(null);
  const [registering, setRegistering] = useState(false);

  const handleTestReachability = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.discoverPrinters(WIFI_DIRECT_IP);
      const found = result.discovered.find((d) => d.ip === WIFI_DIRECT_IP);
      if (found && found.reachable) {
        setTestResult({
          success: true,
          message: `HP Smart Tank 580 is reachable (${found.model})`,
          latencyMs: found.latencyMs,
        });
      } else {
        setTestResult({
          success: false,
          message: `Printer not found at ${WIFI_DIRECT_IP}. Check Wi-Fi Direct connection.`,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Reachability test failed';
      setTestResult({ success: false, message: msg });
    } finally {
      setTesting(false);
    }
  };

  const handleOpenWifiSettings = () => {
    Linking.openURL('android.settings.WIFI_SETTINGS').catch(() => {
      Alert.alert('Cannot Open Settings', 'Please open Wi-Fi settings manually.');
    });
  };

  const handleOpenPrinterWebUI = () => {
    Linking.openURL(`http://${WIFI_DIRECT_IP}`).catch(() => {
      Alert.alert('Browser Error', `Try opening http://${WIFI_DIRECT_IP} manually.`);
    });
  };

  return (
    <View style={styles.screen}>
      <Header title="Wi-Fi Direct Setup" subtitle="HP Smart Tank 580 Connection Guide" />

      <ScrollView contentContainerStyle={styles.content}>
        {/* Status banner */}
        <View style={styles.statusBanner}>
          <Text style={styles.statusBannerText}>
            📡  Wi-Fi Direct IP: <Text style={styles.statusBannerHighlight}>{WIFI_DIRECT_IP}</Text>
            {'  '}|{'  '}IPP Port: <Text style={styles.statusBannerHighlight}>{WIFI_DIRECT_PORT}</Text>
          </Text>
        </View>

        {/* Quick Actions */}
        <View style={styles.quickActions}>
          <TouchableOpacity style={styles.quickBtn} onPress={handleOpenWifiSettings}>
            <Text style={styles.quickBtnIcon}>📶</Text>
            <Text style={styles.quickBtnText}>Open Wi-Fi{'\n'}Settings</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.quickBtn} onPress={handleOpenPrinterWebUI}>
            <Text style={styles.quickBtnIcon}>🌐</Text>
            <Text style={styles.quickBtnText}>Printer{'\n'}Web UI</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.quickBtn, styles.quickBtnPrimary]}
            onPress={handleTestReachability}
            disabled={testing}
          >
            {testing ? (
              <ActivityIndicator size="small" color={DarkTheme.onPrimary} />
            ) : (
              <Text style={styles.quickBtnIcon}>🔍</Text>
            )}
            <Text style={[styles.quickBtnText, { color: DarkTheme.onPrimary }]}>
              Test{'\n'}Connection
            </Text>
          </TouchableOpacity>
        </View>

        {/* Test result */}
        {testResult && (
          <View
            style={[
              styles.testResultBox,
              testResult.success ? styles.testResultSuccess : styles.testResultError,
            ]}
          >
            <Text style={styles.testResultText}>
              {testResult.success ? '✅' : '❌'} {testResult.message}
              {testResult.latencyMs !== undefined &&
                `  (${testResult.latencyMs}ms)`}
            </Text>
          </View>
        )}

        {/* Step-by-step guide */}
        <Text style={styles.guideTitle}>Setup Guide</Text>
        {STEPS.map((step) => (
          <TouchableOpacity
            key={step.id}
            style={[styles.stepCard, activeStep === step.id && styles.stepCardActive]}
            onPress={() => setActiveStep(activeStep === step.id ? null : step.id)}
            activeOpacity={0.85}
          >
            <View style={styles.stepHeader}>
              <View style={styles.stepBadge}>
                <Text style={styles.stepBadgeText}>{step.id}</Text>
              </View>
              <Text style={styles.stepIcon}>{step.icon}</Text>
              <Text style={styles.stepTitle}>{step.title}</Text>
              <Text style={styles.stepChevron}>
                {activeStep === step.id ? '▲' : '▼'}
              </Text>
            </View>

            {activeStep === step.id && (
              <View style={styles.stepBody}>
                <Text style={styles.stepBodyText}>{step.body}</Text>
                {step.isCode && step.codeSnippet && (
                  <View style={styles.codeBox}>
                    <Text style={styles.codeText}>{step.codeSnippet}</Text>
                  </View>
                )}
              </View>
            )}
          </TouchableOpacity>
        ))}

        {/* Security note */}
        <Card style={styles.securityCard}>
          <Text style={styles.securityTitle}>🔐 Security Notes</Text>
          <Text style={styles.securityBody}>
            • Wi-Fi Direct creates an isolated peer-to-peer network. Your phone loses general internet
            access while connected unless using simultaneous Wi-Fi mode.{'\n\n'}
            • PaperPilot server runs locally in Termux and never sends print data outside your device.{'\n\n'}
            • For remote access from another device, use Tailscale VPN and enter your Tailscale IP
            in Settings → Server & Remote Access.
          </Text>
        </Card>

        {/* HP Smart Tank 580 specs */}
        <Card style={styles.specCard}>
          <Text style={styles.specTitle}>HP Smart Tank 580 — Print Specs</Text>
          <View style={styles.specGrid}>
            {[
              ['Protocol', 'IPP 2.0 / PCLm'],
              ['Wi-Fi Direct', 'IEEE 802.11 b/g/n'],
              ['Max Resolution', '4800×1200 dpi (color)'],
              ['Duplex', 'Manual only'],
              ['Max Paper', 'A4 / Letter / Legal'],
              ['Ink System', 'Smart Tank refillable'],
            ].map(([label, value]) => (
              <View key={label} style={styles.specRow}>
                <Text style={styles.specLabel}>{label}</Text>
                <Text style={styles.specValue}>{value}</Text>
              </View>
            ))}
          </View>
        </Card>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: DarkTheme.background,
  },
  content: {
    padding: 16,
    paddingBottom: 48,
  },
  statusBanner: {
    backgroundColor: `${DarkTheme.primary}20`,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: `${DarkTheme.primary}40`,
  },
  statusBannerText: {
    fontSize: 13,
    color: DarkTheme.textSecondary,
    textAlign: 'center',
    fontWeight: '600',
  },
  statusBannerHighlight: {
    color: DarkTheme.primary,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  quickActions: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  quickBtn: {
    flex: 1,
    backgroundColor: DarkTheme.surfaceVariant,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: DarkTheme.border,
  },
  quickBtnPrimary: {
    backgroundColor: DarkTheme.primary,
    borderColor: DarkTheme.primary,
  },
  quickBtnIcon: {
    fontSize: 22,
    marginBottom: 6,
  },
  quickBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: DarkTheme.textSecondary,
    textAlign: 'center',
    lineHeight: 16,
  },
  testResultBox: {
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
  },
  testResultSuccess: {
    backgroundColor: `${DarkTheme.success}18`,
    borderColor: `${DarkTheme.success}50`,
  },
  testResultError: {
    backgroundColor: `${DarkTheme.error}18`,
    borderColor: `${DarkTheme.error}50`,
  },
  testResultText: {
    fontSize: 13,
    color: DarkTheme.text,
    fontWeight: '600',
    lineHeight: 20,
  },
  guideTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: DarkTheme.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  stepCard: {
    backgroundColor: DarkTheme.surface,
    borderRadius: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: DarkTheme.border,
    overflow: 'hidden',
  },
  stepCardActive: {
    borderColor: DarkTheme.primary,
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 10,
  },
  stepBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: DarkTheme.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: DarkTheme.border,
  },
  stepBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: DarkTheme.primary,
  },
  stepIcon: {
    fontSize: 18,
  },
  stepTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: DarkTheme.text,
    lineHeight: 20,
  },
  stepChevron: {
    fontSize: 11,
    color: DarkTheme.textMuted,
  },
  stepBody: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    paddingTop: 2,
    borderTopWidth: 1,
    borderTopColor: DarkTheme.border,
  },
  stepBodyText: {
    fontSize: 13,
    color: DarkTheme.textSecondary,
    lineHeight: 20,
  },
  codeBox: {
    backgroundColor: DarkTheme.surfaceVariant,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 10,
    borderWidth: 1,
    borderColor: DarkTheme.border,
  },
  codeText: {
    fontFamily: 'monospace',
    fontSize: 13,
    color: DarkTheme.primary,
  },
  securityCard: {
    marginTop: 14,
  },
  securityTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: DarkTheme.text,
    marginBottom: 10,
  },
  securityBody: {
    fontSize: 12,
    color: DarkTheme.textSecondary,
    lineHeight: 20,
  },
  specCard: {
    marginTop: 12,
  },
  specTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: DarkTheme.text,
    marginBottom: 12,
  },
  specGrid: {
    gap: 6,
  },
  specRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: DarkTheme.border,
  },
  specLabel: {
    fontSize: 12,
    color: DarkTheme.textMuted,
    fontWeight: '600',
  },
  specValue: {
    fontSize: 12,
    color: DarkTheme.text,
    fontWeight: '700',
  },
});
