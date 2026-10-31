/**
 * ConfirmDuplexModal
 * Shown when a manual duplex job pauses (status = NEEDS_CONFIRMATION) and
 * the user needs to re-feed the paper stack before even pages print.
 */
import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { DarkTheme } from '../theme/colors';
import { PrintJobRecord } from '@paperpilot/shared';
import { api } from '../services/api';

interface ConfirmDuplexModalProps {
  visible: boolean;
  job: PrintJobRecord | null;
  onClose: () => void;
  onConfirmed: () => void;
}

export const ConfirmDuplexModal: React.FC<ConfirmDuplexModalProps> = ({
  visible,
  job,
  onClose,
  onConfirmed,
}) => {
  const [confirming, setConfirming] = useState(false);

  const handleConfirm = async () => {
    if (!job) return;
    setConfirming(true);
    try {
      await api.confirmDuplexStep(job.id);
      Alert.alert(
        'Duplex Step Confirmed ✓',
        'Even pages are now printing on the reverse side.',
        [{ text: 'OK', onPress: onConfirmed }]
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to confirm duplex step';
      Alert.alert('Error', msg);
    } finally {
      setConfirming(false);
    }
  };

  if (!job) return null;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.dialog}>
          {/* Icon */}
          <View style={styles.iconWrap}>
            <Text style={styles.icon}>🔄</Text>
          </View>

          <Text style={styles.title}>Manual Duplex — Re-feed Paper</Text>
          <Text style={styles.subtitle}>
            Job: <Text style={styles.jobName}>{job.document_id}</Text>
          </Text>

          <View style={styles.instructionBox}>
            <Text style={styles.step}>① Remove printed pages from output tray</Text>
            <Text style={styles.step}>② Flip stack face-down, top edge first</Text>
            <Text style={styles.step}>③ Place back into input tray</Text>
            <Text style={styles.step}>④ Tap "Continue Printing" below</Text>
          </View>

          <Text style={styles.warningText}>
            ⚠  Do NOT tap continue until paper is re-loaded. Misfeeds will cause misprints.
          </Text>

          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={onClose}
              disabled={confirming}
            >
              <Text style={styles.cancelBtnText}>Cancel Job</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.confirmBtn, confirming && styles.btnDisabled]}
              onPress={handleConfirm}
              disabled={confirming}
            >
              {confirming ? (
                <ActivityIndicator size="small" color={DarkTheme.onPrimary} />
              ) : (
                <Text style={styles.confirmBtnText}>Continue Printing →</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  dialog: {
    backgroundColor: DarkTheme.surface,
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    borderColor: DarkTheme.border,
  },
  iconWrap: {
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: `${DarkTheme.primary}22`,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  icon: {
    fontSize: 32,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: DarkTheme.text,
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 12,
    color: DarkTheme.textMuted,
    textAlign: 'center',
    marginBottom: 18,
  },
  jobName: {
    color: DarkTheme.textSecondary,
    fontWeight: '700',
  },
  instructionBox: {
    backgroundColor: DarkTheme.surfaceVariant,
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
    gap: 8,
  },
  step: {
    fontSize: 14,
    color: DarkTheme.text,
    lineHeight: 22,
    fontWeight: '500',
  },
  warningText: {
    fontSize: 12,
    color: DarkTheme.warning,
    lineHeight: 18,
    marginBottom: 20,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: DarkTheme.surfaceVariant,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: DarkTheme.error,
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: DarkTheme.error,
  },
  confirmBtn: {
    flex: 2,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: DarkTheme.primary,
    alignItems: 'center',
    elevation: 4,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  confirmBtnText: {
    fontSize: 15,
    fontWeight: '800',
    color: DarkTheme.onPrimary,
  },
});
