import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { DarkTheme } from '../theme/colors';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { StatusBadge } from '../components/StatusBadge';
import { useAppStore } from '../store/useAppStore';

export const HomeScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const {
    printers,
    queue,
    documents,
    serverHealth,
    serverConnected,
    fetchDocuments,
    fetchQueue,
    fetchPrinters,
    checkServerHealth,
  } = useAppStore();

  const [refreshing, setRefreshing] = React.useState(false);

  const loadData = async () => {
    setRefreshing(true);
    await Promise.all([checkServerHealth(), fetchPrinters(), fetchQueue(), fetchDocuments()]);
    setRefreshing(false);
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(() => {
      checkServerHealth();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const defaultPrinter = printers.find((p) => p.is_default) || printers[0];
  const pendingJobs = queue.filter((j) => ['PENDING', 'WAITING_FOR_PRINTER', 'VALIDATING'].includes(j.status));
  const activeJob = queue.find((j) => ['PRINTING', 'SUBMITTED'].includes(j.status));

  return (
    <View style={styles.screen}>
      <Header title="PaperPilot" subtitle="HP Smart Tank 580 Print Assistant" />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadData} tintColor={DarkTheme.primary} />}
      >
        {/* Welcome Section */}
        <View style={styles.welcomeSection}>
          <Text style={styles.welcomeTitle}>Ready to Print</Text>
          <Text style={styles.welcomeSubtitle}>
            Offline-first intelligent spooler. Auto-dispatches when your printer is detected.
          </Text>
        </View>

        {/* Printer Status Banner */}
        <Card variant="surfaceVariant">
          <View style={styles.rowBetween}>
            <View>
              <Text style={styles.printerModel}>{defaultPrinter?.name || 'HP Smart Tank 580'}</Text>
              <Text style={styles.printerIp}>IP: {defaultPrinter?.ip_address || '192.168.223.1'} (Wi-Fi Direct)</Text>
            </View>
            <StatusBadge status={defaultPrinter?.status || 'DISCONNECTED'} />
          </View>
          <View style={styles.cardActions}>
            <TouchableOpacity
              style={styles.outlineButton}
              onPress={() => navigation.navigate('Printers')}
            >
              <Text style={styles.outlineButtonText}>Hardware Diagnostics</Text>
            </TouchableOpacity>
          </View>
        </Card>

        {/* Active Print Job Banner (if printing) */}
        {activeJob && (
          <Card style={{ borderColor: DarkTheme.primary }}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>Printing Now</Text>
              <StatusBadge status={activeJob.status} />
            </View>
            <Text style={styles.docName}>{activeJob.document?.original_name || 'Document'}</Text>
            <Text style={styles.jobSubtext}>
              Copy {activeJob.last_confirmed_copy || 1} of {activeJob.copies} | Page Range: {activeJob.page_range}
            </Text>
          </Card>
        )}

        {/* Queue Overview Summary */}
        <View style={styles.statsGrid}>
          <Card style={styles.statCard}>
            <Text style={styles.statValue}>{pendingJobs.length}</Text>
            <Text style={styles.statLabel}>Pending Jobs</Text>
          </Card>
          <Card style={styles.statCard}>
            <Text style={styles.statValue}>{documents.length}</Text>
            <Text style={styles.statLabel}>Uploaded Files</Text>
          </Card>
        </View>

        {/* Quick Actions */}
        <View style={styles.actionButtons}>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => navigation.navigate('Documents')}
          >
            <Text style={styles.primaryButtonText}>+ Upload New Document</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => navigation.navigate('Queue')}
          >
            <Text style={styles.secondaryButtonText}>View Print Queue ({queue.length})</Text>
          </TouchableOpacity>
        </View>

        {/* Local Termux Environment Telemetry */}
        <Card style={styles.telemetryCard}>
          <Text style={styles.telemetryTitle}>Termux Engine Telemetry</Text>
          <View style={styles.telemetryRow}>
            <Text style={styles.telemetryLabel}>Loopback:</Text>
            <Text style={styles.telemetryValue}>http://127.0.0.1:5000</Text>
          </View>
          <View style={styles.telemetryRow}>
            <Text style={styles.telemetryLabel}>Server Memory (RSS):</Text>
            <Text style={styles.telemetryValue}>{serverHealth?.memory.rss_mb || 0} MB</Text>
          </View>
          <View style={styles.telemetryRow}>
            <Text style={styles.telemetryLabel}>Storage Managed:</Text>
            <Text style={styles.telemetryValue}>{serverHealth?.storage.storage_size_mb || 0} MB</Text>
          </View>
          <View style={styles.telemetryRow}>
            <Text style={styles.telemetryLabel}>SQLite WAL Database:</Text>
            <Text style={[styles.telemetryValue, { color: DarkTheme.success }]}>Active</Text>
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
    paddingBottom: 32,
  },
  welcomeSection: {
    marginBottom: 16,
  },
  welcomeTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: DarkTheme.text,
  },
  welcomeSubtitle: {
    fontSize: 13,
    color: DarkTheme.textSecondary,
    marginTop: 4,
    lineHeight: 18,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  printerModel: {
    fontSize: 16,
    fontWeight: '700',
    color: DarkTheme.text,
  },
  printerIp: {
    fontSize: 12,
    color: DarkTheme.textSecondary,
    marginTop: 2,
  },
  cardActions: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: DarkTheme.border,
    paddingTop: 8,
  },
  outlineButton: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: DarkTheme.primary,
  },
  outlineButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: DarkTheme.primary,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: DarkTheme.text,
  },
  docName: {
    fontSize: 16,
    fontWeight: '600',
    color: DarkTheme.text,
    marginTop: 6,
  },
  jobSubtext: {
    fontSize: 12,
    color: DarkTheme.textSecondary,
    marginTop: 4,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 12,
    marginVertical: 6,
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
  },
  statValue: {
    fontSize: 26,
    fontWeight: '800',
    color: DarkTheme.primary,
  },
  statLabel: {
    fontSize: 12,
    color: DarkTheme.textSecondary,
    marginTop: 4,
  },
  actionButtons: {
    marginVertical: 12,
    gap: 10,
  },
  primaryButton: {
    backgroundColor: DarkTheme.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: DarkTheme.onPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: DarkTheme.surfaceVariant,
    borderWidth: 1,
    borderColor: DarkTheme.border,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: DarkTheme.text,
    fontSize: 14,
    fontWeight: '600',
  },
  telemetryCard: {
    marginTop: 12,
  },
  telemetryTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: DarkTheme.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  telemetryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  telemetryLabel: {
    fontSize: 13,
    color: DarkTheme.textMuted,
  },
  telemetryValue: {
    fontSize: 13,
    fontWeight: '600',
    color: DarkTheme.text,
  },
});
