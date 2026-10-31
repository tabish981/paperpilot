import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  TextInput,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { DarkTheme } from '../theme/colors';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { api } from '../services/api';
import { useAppStore } from '../store/useAppStore';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';

type SettingsNav = NativeStackNavigationProp<RootStackParamList>;

export const SettingsScreen: React.FC = () => {
  const navigation = useNavigation<SettingsNav>();
  const { serverHealth, checkServerHealth } = useAppStore();
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const [autoPrint, setAutoPrint] = useState(true);
  const [batteryCutoff, setBatteryCutoff] = useState('15');
  const [bwRate, setBwRate] = useState('2.0');
  const [colorRate, setColorRate] = useState('10.0');
  const [paperRate, setPaperRate] = useState('0.5');

  const [serverHost, setServerHost] = useState(api.getServerUrl());
  const [remoteToken, setRemoteToken] = useState('');

  // Load saved automation settings from server
  useEffect(() => {
    (async () => {
      try {
        const settings = await api.getAutomationSettings();
        setAutoPrint(settings.auto_print_when_reachable);
        setBatteryCutoff(String(settings.battery_cutoff_percent));
        setBwRate(String(settings.bw_rate));
        setColorRate(String(settings.color_rate));
        setPaperRate(String(settings.paper_rate));
        setSettingsLoaded(true);
      } catch {
        // Use defaults if server unreachable
        setSettingsLoaded(true);
      }
    })();
  }, []);

  const handleSaveAutomation = async () => {
    try {
      await api.saveAutomationSettings({
        auto_print_when_reachable: autoPrint,
        battery_cutoff_percent: parseInt(batteryCutoff, 10) || 15,
        bw_rate: parseFloat(bwRate) || 2.0,
        color_rate: parseFloat(colorRate) || 10.0,
        paper_rate: parseFloat(paperRate) || 0.5,
      });
      Alert.alert('Settings Saved', 'Automation rules and cost rates have been persisted to the server.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      Alert.alert('Save Error', msg);
    }
  };

  const handleSaveServerConfig = () => {
    api.setServerUrl(serverHost.trim());
    if (remoteToken.trim()) {
      api.setAuthToken(remoteToken.trim());
    } else {
      api.setAuthToken(null);
    }
    checkServerHealth();
    Alert.alert('Server Configuration Updated', `API base pointing to: ${serverHost.trim()}`);
  };

  const handleCreateBackup = async () => {
    try {
      const res = await api.createBackup();
      Alert.alert('Database Backup Created', `Saved snapshot to: ${res.backup_file}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Backup failed';
      Alert.alert('Backup Error', msg);
    }
  };

  return (
    <View style={styles.screen}>
      <Header title="Settings" subtitle="Automation, Rates & Server" />

      <ScrollView contentContainerStyle={styles.content}>
        {/* Automation Engine Rules */}
        <Card>
          <Text style={styles.sectionHeader}>PrintBrain Automation Engine</Text>

          <View style={styles.settingRow}>
            <View style={{ flex: 1, marginRight: 10 }}>
              <Text style={styles.settingLabel}>Auto-Print When Reachable</Text>
              <Text style={styles.settingDescription}>
                Automatically dispatches pending print jobs once HP printer responds to IPP handshake.
              </Text>
            </View>
            <Switch
              value={autoPrint}
              onValueChange={setAutoPrint}
              trackColor={{ false: DarkTheme.surfaceVariant, true: DarkTheme.primary }}
              thumbColor={DarkTheme.text}
            />
          </View>

          <View style={styles.inputRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>Battery Cutoff Threshold (%)</Text>
              <Text style={styles.settingDescription}>
                Pauses automatic printing if phone battery drops below this percentage.
              </Text>
            </View>
            <TextInput
              style={styles.numericInput}
              keyboardType="numeric"
              value={batteryCutoff}
              onChangeText={setBatteryCutoff}
            />
          </View>

          <TouchableOpacity style={styles.saveAutomationBtn} onPress={handleSaveAutomation}>
            <Text style={styles.saveAutomationBtnText}>Save Automation & Cost Settings</Text>
          </TouchableOpacity>
        </Card>

        {/* Print Cost Calculator Rates */}
        <Card style={{ marginTop: 12 }}>
          <Text style={styles.sectionHeader}>Print Cost Rates (INR ₹)</Text>

          <View style={styles.costGrid}>
            <View style={styles.costItem}>
              <Text style={styles.costLabel}>B&W / Page</Text>
              <TextInput
                style={styles.costInput}
                keyboardType="numeric"
                value={bwRate}
                onChangeText={setBwRate}
              />
            </View>
            <View style={styles.costItem}>
              <Text style={styles.costLabel}>Color / Page</Text>
              <TextInput
                style={styles.costInput}
                keyboardType="numeric"
                value={colorRate}
                onChangeText={setColorRate}
              />
            </View>
            <View style={styles.costItem}>
              <Text style={styles.costLabel}>Paper / Sheet</Text>
              <TextInput
                style={styles.costInput}
                keyboardType="numeric"
                value={paperRate}
                onChangeText={setPaperRate}
              />
            </View>
          </View>
        </Card>

        {/* Server & Remote Access Configuration */}
        <Card style={{ marginTop: 12 }}>
          <Text style={styles.sectionHeader}>Server & Remote Access (Tailscale)</Text>
          <Text style={styles.settingDescription}>
            Defaults to http://127.0.0.1:5000 for local Termux on the same phone. Enter Tailscale IP for remote control from another phone or PC.
          </Text>

          <View style={styles.inputGroup}>
            <Text style={styles.inputGroupLabel}>Server Base URL:</Text>
            <TextInput
              style={styles.textInput}
              value={serverHost}
              onChangeText={setServerHost}
              placeholder="http://127.0.0.1:5000"
              placeholderTextColor={DarkTheme.textMuted}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputGroupLabel}>Remote Bearer Token (if non-localhost):</Text>
            <TextInput
              style={styles.textInput}
              value={remoteToken}
              onChangeText={setRemoteToken}
              placeholder="Optional Bearer API token"
              placeholderTextColor={DarkTheme.textMuted}
              secureTextEntry
            />
          </View>

          <TouchableOpacity style={styles.saveServerBtn} onPress={handleSaveServerConfig}>
            <Text style={styles.saveServerBtnText}>Save Server Connection</Text>
          </TouchableOpacity>
        </Card>

        {/* Termux Server Diagnostics & Backup */}
        <Card style={{ marginTop: 12 }}>
          <Text style={styles.sectionHeader}>Termux Local Diagnostics & Backup</Text>
          <View style={styles.diagRow}>
            <Text style={styles.diagLabel}>Server Uptime:</Text>
            <Text style={styles.diagValue}>{serverHealth?.uptime_seconds || 0} seconds</Text>
          </View>
          <View style={styles.diagRow}>
            <Text style={styles.diagLabel}>Node Heap Used:</Text>
            <Text style={styles.diagValue}>{serverHealth?.memory.heap_used_mb || 0} MB</Text>
          </View>
          <View style={styles.diagRow}>
            <Text style={styles.diagLabel}>Physical Storage Used:</Text>
            <Text style={styles.diagValue}>{serverHealth?.storage.storage_size_mb || 0} MB</Text>
          </View>

          <TouchableOpacity style={styles.backupBtn} onPress={handleCreateBackup}>
            <Text style={styles.backupBtnText}>Create SQLite Database Snapshot</Text>
          </TouchableOpacity>
        </Card>

        {/* Wi-Fi Direct Setup Guide */}
        <Card style={{ marginTop: 12 }}>
          <Text style={styles.sectionHeader}>Printer Connection</Text>
          <Text style={styles.settingDescription}>
            Step-by-step guide for connecting your Android phone to the HP Smart Tank 580 via Wi-Fi Direct.
          </Text>
          <TouchableOpacity
            style={styles.wifiDirectBtn}
            onPress={() => navigation.navigate('WifiDirect')}
          >
            <Text style={styles.wifiDirectBtnText}>📶  Open Wi-Fi Direct Setup Guide</Text>
          </TouchableOpacity>
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
    paddingBottom: 40,
  },
  sectionHeader: {
    fontSize: 14,
    fontWeight: '800',
    color: DarkTheme.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: DarkTheme.border,
    marginTop: 6,
  },
  settingLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: DarkTheme.text,
  },
  settingDescription: {
    fontSize: 12,
    color: DarkTheme.textSecondary,
    marginTop: 2,
    lineHeight: 16,
  },
  numericInput: {
    backgroundColor: DarkTheme.surfaceVariant,
    color: DarkTheme.text,
    borderWidth: 1,
    borderColor: DarkTheme.border,
    borderRadius: 8,
    width: 60,
    textAlign: 'center',
    paddingVertical: 6,
    fontSize: 15,
    fontWeight: '700',
  },
  costGrid: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  costItem: {
    flex: 1,
  },
  costLabel: {
    fontSize: 11,
    color: DarkTheme.textMuted,
    marginBottom: 4,
    fontWeight: '600',
  },
  costInput: {
    backgroundColor: DarkTheme.surfaceVariant,
    color: DarkTheme.text,
    borderWidth: 1,
    borderColor: DarkTheme.border,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  inputGroup: {
    marginTop: 10,
  },
  inputGroupLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: DarkTheme.textSecondary,
    marginBottom: 4,
  },
  textInput: {
    backgroundColor: DarkTheme.surfaceVariant,
    color: DarkTheme.text,
    borderWidth: 1,
    borderColor: DarkTheme.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
  },
  saveServerBtn: {
    backgroundColor: DarkTheme.surfaceVariant,
    borderWidth: 1,
    borderColor: DarkTheme.primary,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 12,
  },
  saveServerBtnText: {
    color: DarkTheme.primary,
    fontWeight: '700',
    fontSize: 13,
  },
  diagRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  diagLabel: {
    fontSize: 12,
    color: DarkTheme.textMuted,
  },
  diagValue: {
    fontSize: 12,
    fontWeight: '600',
    color: DarkTheme.text,
  },
  backupBtn: {
    backgroundColor: DarkTheme.primary,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 12,
  },
  backupBtnText: {
    color: DarkTheme.onPrimary,
    fontWeight: '700',
    fontSize: 13,
  },
  saveAutomationBtn: {
    backgroundColor: DarkTheme.primary,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 14,
  },
  saveAutomationBtnText: {
    color: DarkTheme.onPrimary,
    fontWeight: '700',
    fontSize: 13,
  },
  wifiDirectBtn: {
    backgroundColor: DarkTheme.surfaceVariant,
    borderWidth: 1,
    borderColor: '#0ea5e9',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  wifiDirectBtnText: {
    color: '#38bdf8',
    fontWeight: '700',
    fontSize: 14,
  },
});
