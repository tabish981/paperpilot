/**
 * RecoveryModal
 * Shown when a print job has status INTERRUPTED or FAILED.
 * Fetches the recovery plan from the server and lets the user
 * confirm the last good page then resume from the correct position.
 */
import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
} from 'react-native';
import { DarkTheme } from '../theme/colors';
import { PrintJobRecord } from '@paperpilot/shared';
import { api } from '../services/api';

interface RecoveryPlan {
  job_id: string;
  status: string;
  total_pages: number;
  total_copies: number;
  last_successful_page: number;
  last_successful_copy: number;
  pages_printed: number;
  pages_remaining: number;
  resume_suggestion: { resume_from_page: number; resume_from_copy: number };
}

interface RecoveryModalProps {
  visible: boolean;
  job: PrintJobRecord | null;
  onClose: () => void;
  onRecovered: () => void;
}

export const RecoveryModal: React.FC<RecoveryModalProps> = ({
  visible,
  job,
  onClose,
  onRecovered,
}) => {
  const [plan, setPlan] = useState<RecoveryPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [recovering, setRecovering] = useState(false);

  const [confirmedPage, setConfirmedPage] = useState('');
  const [resumeFromPage, setResumeFromPage] = useState('');
  const [resumeFromCopy, setResumeFromCopy] = useState('');

  useEffect(() => {
    if (visible && job) {
      fetchRecoveryPlan();
    }
  }, [visible, job]);

  useEffect(() => {
    if (plan) {
      setConfirmedPage(String(plan.last_successful_page));
      setResumeFromPage(String(plan.resume_suggestion.resume_from_page));
      setResumeFromCopy(String(plan.resume_suggestion.resume_from_copy));
    }
  }, [plan]);

  const fetchRecoveryPlan = async () => {
    if (!job) return;
    setLoading(true);
    try {
      const p = await api.getRecoveryPlan(job.id);
      setPlan(p);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not load recovery plan';
      Alert.alert('Recovery Plan Error', msg);
    } finally {
      setLoading(false);
    }
  };

  const handleRecover = async () => {
    if (!job || !plan) return;
    const confirmed = parseInt(confirmedPage, 10);
    const fromPage = parseInt(resumeFromPage, 10);
    const fromCopy = parseInt(resumeFromCopy, 10);

    if (isNaN(confirmed) || isNaN(fromPage) || isNaN(fromCopy)) {
      Alert.alert('Invalid Input', 'Please enter valid numbers for all fields.');
      return;
    }

    setRecovering(true);
    try {
      await api.recoverJob(job.id, {
        confirmed_completed_page: confirmed,
        resume_from_page: fromPage,
        resume_from_copy: fromCopy,
      });
      Alert.alert(
        'Job Recovered ✓',
        `Resuming print from page ${fromPage}, copy ${fromCopy}.`,
        [{ text: 'OK', onPress: onRecovered }]
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Recovery failed';
      Alert.alert('Recovery Error', msg);
    } finally {
      setRecovering(false);
    }
  };

  if (!job) return null;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.dialog}>
          <View style={styles.iconWrap}>
            <Text style={styles.icon}>⚡</Text>
          </View>

          <Text style={styles.title}>Interrupted Print Recovery</Text>
          <Text style={styles.subtitle}>
            Job ID: <Text style={styles.jobId}>{job.id.slice(0, 8)}…</Text>
          </Text>

          {loading ? (
            <ActivityIndicator size="large" color={DarkTheme.primary} style={{ marginVertical: 24 }} />
          ) : plan ? (
            <>
              {/* Recovery plan summary */}
              <View style={styles.planGrid}>
                <View style={styles.planCell}>
                  <Text style={styles.planLabel}>Pages Printed</Text>
                  <Text style={styles.planValue}>{plan.pages_printed}</Text>
                </View>
                <View style={styles.planCell}>
                  <Text style={styles.planLabel}>Pages Remaining</Text>
                  <Text style={[styles.planValue, { color: DarkTheme.warning }]}>
                    {plan.pages_remaining}
                  </Text>
                </View>
                <View style={styles.planCell}>
                  <Text style={styles.planLabel}>Total Copies</Text>
                  <Text style={styles.planValue}>{plan.total_copies}</Text>
                </View>
              </View>

              <Text style={styles.sectionLabel}>CONFIRM LAST PRINTED PAGE</Text>
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                value={confirmedPage}
                onChangeText={setConfirmedPage}
                placeholder="Last page successfully printed"
                placeholderTextColor={DarkTheme.textMuted}
              />

              <Text style={styles.sectionLabel}>RESUME FROM PAGE</Text>
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                value={resumeFromPage}
                onChangeText={setResumeFromPage}
                placeholder={`Suggested: ${plan.resume_suggestion.resume_from_page}`}
                placeholderTextColor={DarkTheme.textMuted}
              />

              <Text style={styles.sectionLabel}>RESUME FROM COPY #</Text>
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                value={resumeFromCopy}
                onChangeText={setResumeFromCopy}
                placeholder={`Suggested: ${plan.resume_suggestion.resume_from_copy}`}
                placeholderTextColor={DarkTheme.textMuted}
              />

              <Text style={styles.hintText}>
                💡 The server pre-filled suggested values based on the last IPP status response.
                Adjust manually if the paper jam occurred mid-page.
              </Text>
            </>
          ) : (
            <Text style={styles.errorText}>Failed to load recovery plan. Try again.</Text>
          )}

          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={onClose}
              disabled={recovering}
            >
              <Text style={styles.closeBtnText}>Close</Text>
            </TouchableOpacity>
            {plan && (
              <TouchableOpacity
                style={[styles.recoverBtn, recovering && styles.btnDisabled]}
                onPress={handleRecover}
                disabled={recovering || loading}
              >
                {recovering ? (
                  <ActivityIndicator size="small" color={DarkTheme.onPrimary} />
                ) : (
                  <Text style={styles.recoverBtnText}>Resume Print →</Text>
                )}
              </TouchableOpacity>
            )}
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
    maxWidth: 420,
    borderWidth: 1,
    borderColor: DarkTheme.border,
  },
  iconWrap: {
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: `${DarkTheme.warning}20`,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  icon: {
    fontSize: 30,
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
    marginBottom: 16,
  },
  jobId: {
    color: DarkTheme.primary,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  planGrid: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  planCell: {
    flex: 1,
    backgroundColor: DarkTheme.surfaceVariant,
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: DarkTheme.border,
  },
  planLabel: {
    fontSize: 10,
    color: DarkTheme.textMuted,
    fontWeight: '600',
    marginBottom: 4,
    textAlign: 'center',
  },
  planValue: {
    fontSize: 20,
    fontWeight: '800',
    color: DarkTheme.text,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: DarkTheme.textSecondary,
    letterSpacing: 0.6,
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    backgroundColor: DarkTheme.surfaceVariant,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: DarkTheme.border,
    color: DarkTheme.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontWeight: '700',
  },
  hintText: {
    fontSize: 11,
    color: DarkTheme.textMuted,
    lineHeight: 17,
    marginTop: 10,
    marginBottom: 4,
  },
  errorText: {
    fontSize: 13,
    color: DarkTheme.error,
    textAlign: 'center',
    marginVertical: 16,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  closeBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: DarkTheme.surfaceVariant,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: DarkTheme.border,
  },
  closeBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: DarkTheme.textSecondary,
  },
  recoverBtn: {
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
  recoverBtnText: {
    fontSize: 15,
    fontWeight: '800',
    color: DarkTheme.onPrimary,
  },
});
