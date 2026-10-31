import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
  RefreshControl,
} from 'react-native';
import { DarkTheme } from '../theme/colors';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { StatusBadge } from '../components/StatusBadge';
import { useAppStore } from '../store/useAppStore';
import { api } from '../services/api';
import { PrintJobRecord } from '@paperpilot/shared';
import { ConfirmDuplexModal } from '../components/ConfirmDuplexModal';
import { RecoveryModal } from '../components/RecoveryModal';

export const QueueScreen: React.FC = () => {
  const { queue, isQueuePaused, activeJobProgress, fetchQueue } = useAppStore();
  const [refreshing, setRefreshing] = useState(false);

  // Recovery & Duplex modal state
  const [selectedJobForDuplex, setSelectedJobForDuplex] = useState<PrintJobRecord | null>(null);
  const [selectedJobForRecovery, setSelectedJobForRecovery] = useState<PrintJobRecord | null>(null);

  useEffect(() => {
    fetchQueue();
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchQueue();
    setRefreshing(false);
  };

  const handleToggleGlobalQueue = async () => {
    try {
      if (isQueuePaused) {
        await api.resumeAllQueue();
      } else {
        await api.pauseAllQueue();
      }
      await fetchQueue();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error';
      Alert.alert('Queue Action Failed', msg);
    }
  };

  const handleClearCompleted = async () => {
    try {
      const res = await api.clearCompletedQueue();
      await fetchQueue();
      Alert.alert('Queue Cleaned', res.message);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error';
      Alert.alert('Clear Failed', msg);
    }
  };

  const handlePause = async (jobId: string) => {
    try {
      await api.pauseJob(jobId);
      await fetchQueue();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error';
      Alert.alert('Pause Failed', msg);
    }
  };

  const handleResume = async (jobId: string) => {
    try {
      await api.resumeJob(jobId);
      await fetchQueue();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error';
      Alert.alert('Resume Failed', msg);
    }
  };

  const handleRetry = async (jobId: string) => {
    try {
      await api.retryJob(jobId);
      await fetchQueue();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error';
      Alert.alert('Retry Failed', msg);
    }
  };

  const handleCancel = (jobId: string) => {
    Alert.alert('Cancel Job', 'Are you sure you want to cancel this print job?', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Yes, Cancel',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.cancelJob(jobId);
            await fetchQueue();
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Error';
            Alert.alert('Cancel Failed', msg);
          }
        },
      },
    ]);
  };

  const handleMove = async (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= queue.length) return;

    const newOrder = [...queue];
    const temp = newOrder[index];
    newOrder[index] = newOrder[targetIndex];
    newOrder[targetIndex] = temp;

    const jobIds = newOrder.map((j) => j.id);
    try {
      await api.reorderQueue(jobIds);
      await fetchQueue();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error';
      Alert.alert('Reorder Failed', msg);
    }
  };

  const openRecoveryModal = (job: PrintJobRecord) => {
    setSelectedJobForRecovery(job);
    const lastPage = job.last_confirmed_page || 0;
    setConfirmedPage(lastPage.toString());
    setResumePage((lastPage + 1).toString());
  };

  const commitRecovery = async () => {
    if (!selectedJobForRecovery) return;
    try {
      await api.recoverJob(selectedJobForRecovery.id, {
        confirmed_completed_page: parseInt(confirmedPage, 10),
        resume_from_page: parseInt(resumePage, 10),
        resume_from_copy: selectedJobForRecovery.last_confirmed_copy || 1,
      });
      setSelectedJobForRecovery(null);
      await fetchQueue();
      Alert.alert(
        'Recovery Checkpoint Saved',
        `Job will resume from page ${resumePage} when printer is ready.`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Recovery failed';
      Alert.alert('Recovery Error', msg);
    }
  };

  return (
    <View style={styles.screen}>
      <Header
        title="Print Queue"
        subtitle={isQueuePaused ? 'QUEUE PAUSED' : `${queue.length} jobs in queue`}
      />

      {/* Global Queue Controls Bar */}
      <View style={styles.topControlBar}>
        <TouchableOpacity
          style={[styles.globalBtn, isQueuePaused ? styles.resumeBtn : styles.pauseBtn]}
          onPress={handleToggleGlobalQueue}
        >
          <Text style={styles.globalBtnText}>
            {isQueuePaused ? '▶ Resume Entire Queue' : '⏸ Pause Entire Queue'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.clearBtn} onPress={handleClearCompleted}>
          <Text style={styles.clearBtnText}>Clear Finished</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={queue}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={DarkTheme.primary} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>Queue is Empty</Text>
            <Text style={styles.emptySubtitle}>
              Documents enqueued for printing will execute in priority order automatically.
            </Text>
          </View>
        }
        renderItem={({ item, index }) => {
          const isPrintingThis = item.status === 'PRINTING';
          const progress = isPrintingThis ? activeJobProgress : null;

          return (
            <Card
              style={{
                borderColor:
                  item.status === 'NEEDS_CONFIRMATION'
                    ? DarkTheme.accent
                    : isPrintingThis
                    ? DarkTheme.primary
                    : DarkTheme.border,
              }}
            >
              <View style={styles.jobHeader}>
                {/* Reorder Arrows */}
                <View style={styles.reorderColumn}>
                  <TouchableOpacity
                    style={[styles.arrowBtn, index === 0 && { opacity: 0.3 }]}
                    onPress={() => handleMove(index, 'up')}
                    disabled={index === 0}
                  >
                    <Text style={styles.arrowText}>▲</Text>
                  </TouchableOpacity>
                  <Text style={styles.posText}>#{index + 1}</Text>
                  <TouchableOpacity
                    style={[styles.arrowBtn, index === queue.length - 1 && { opacity: 0.3 }]}
                    onPress={() => handleMove(index, 'down')}
                    disabled={index === queue.length - 1}
                  >
                    <Text style={styles.arrowText}>▼</Text>
                  </TouchableOpacity>
                </View>

                {/* Job Metadata */}
                <View style={styles.jobInfo}>
                  <View style={styles.nameRow}>
                    <Text style={styles.docTitle} numberOfLines={1}>
                      {item.document?.original_name || 'Print Document'}
                    </Text>
                    {item.priority < 50 && (
                      <View style={styles.urgentBadge}>
                        <Text style={styles.urgentBadgeText}>HIGH PRIORITY</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.jobParams}>
                    {item.copies} {item.copies === 1 ? 'copy' : 'copies'} • {item.paper_size} •{' '}
                    {item.color_mode === 'color' ? 'Color' : 'B&W'} • {item.duplex_mode}
                  </Text>
                </View>

                <StatusBadge status={item.status} />
              </View>

              {/* Live Print Progress Bar */}
              {isPrintingThis && (
                <View style={styles.liveProgressWrapper}>
                  <View style={styles.progressRow}>
                    <Text style={styles.progressLabel}>
                      Printing Copy {progress?.copy || item.last_confirmed_copy || 1} of {item.copies}
                    </Text>
                    <Text style={styles.progressPages}>
                      Page {progress?.page || item.last_confirmed_page || 1} / {progress?.totalPages || item.document?.page_count || 1}
                    </Text>
                  </View>
                  <View style={styles.progressBarBg}>
                    <View
                      style={[
                        styles.progressBarFill,
                        {
                          width: `${Math.min(
                            100,
                            Math.round(
                              (((progress?.page || 1) - 1) /
                                (progress?.totalPages || item.document?.page_count || 1)) *
                                100
                            )
                          )}%`,
                        },
                      ]}
                    />
                  </View>
                </View>
              )}

              {/* Checkpoint Banner for Interrupted / Needs Confirmation */}
              {['NEEDS_CONFIRMATION', 'INTERRUPTED'].includes(item.status) && (
                <View style={styles.recoveryAlert}>
                  <Text style={styles.recoveryAlertTitle}>Intelligent Print Recovery Required</Text>
                  <Text style={styles.recoveryAlertText}>
                    Connection was interrupted. Last confirmed physical sheet: Page {item.last_confirmed_page || 0}.
                  </Text>
                  <TouchableOpacity
                    style={styles.recoveryButton}
                    onPress={() => openRecoveryModal(item)}
                  >
                    <Text style={styles.recoveryButtonText}>Review & Resume</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Queue Controls */}
              <View style={styles.actionsRow}>
                {item.status === 'PAUSED' ? (
                  <TouchableOpacity style={styles.actionBtn} onPress={() => handleResume(item.id)}>
                    <Text style={[styles.actionBtnText, { color: DarkTheme.primary }]}>Resume</Text>
                  </TouchableOpacity>
                ) : item.status !== 'COMPLETED' && item.status !== 'CANCELLED' && item.status !== 'PRINTING' ? (
                  <TouchableOpacity style={styles.actionBtn} onPress={() => handlePause(item.id)}>
                    <Text style={[styles.actionBtnText, { color: DarkTheme.accent }]}>Pause</Text>
                  </TouchableOpacity>
                ) : null}

                {['FAILED', 'CANCELLED'].includes(item.status) && (
                  <TouchableOpacity style={styles.actionBtn} onPress={() => handleRetry(item.id)}>
                    <Text style={[styles.actionBtnText, { color: DarkTheme.primary }]}>Retry</Text>
                  </TouchableOpacity>
                )}

                {item.status !== 'COMPLETED' && item.status !== 'CANCELLED' && (
                  <TouchableOpacity style={styles.actionBtn} onPress={() => handleCancel(item.id)}>
                    <Text style={[styles.actionBtnText, { color: DarkTheme.error }]}>Cancel</Text>
                  </TouchableOpacity>
                )}
              </View>
            </Card>
          );
        }}
      />

      {/* Manual Recovery Confirmation Modal */}
      <Modal
        visible={!!selectedJobForRecovery}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedJobForRecovery(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Intelligent Print Recovery</Text>
            <Text style={styles.modalSubtitle}>
              PaperPilot prevents reprinting already completed pages. Confirm the physical sheets printed before the error.
            </Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Last Successfully Printed Page:</Text>
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                value={confirmedPage}
                onChangeText={(val) => {
                  setConfirmedPage(val);
                  setResumePage((parseInt(val || '0', 10) + 1).toString());
                }}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Resume Printing From Page:</Text>
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                value={resumePage}
                onChangeText={setResumePage}
              />
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => setSelectedJobForRecovery(null)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirm} onPress={commitRecovery}>
                <Text style={styles.modalConfirmText}>Resume from Page {resumePage}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: DarkTheme.background,
  },
  topControlBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: DarkTheme.border,
  },
  globalBtn: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pauseBtn: {
    backgroundColor: DarkTheme.surfaceVariant,
    borderWidth: 1,
    borderColor: DarkTheme.accent,
  },
  resumeBtn: {
    backgroundColor: DarkTheme.primary,
  },
  globalBtnText: {
    color: DarkTheme.text,
    fontSize: 12,
    fontWeight: '700',
  },
  clearBtn: {
    backgroundColor: DarkTheme.surfaceVariant,
    borderRadius: 8,
    paddingHorizontal: 12,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: DarkTheme.border,
  },
  clearBtnText: {
    color: DarkTheme.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
  list: {
    padding: 16,
    paddingBottom: 40,
  },
  jobHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  reorderColumn: {
    alignItems: 'center',
    marginRight: 10,
  },
  arrowBtn: {
    padding: 2,
  },
  arrowText: {
    fontSize: 10,
    color: DarkTheme.textSecondary,
  },
  posText: {
    fontSize: 12,
    fontWeight: '800',
    color: DarkTheme.primary,
    marginVertical: 1,
  },
  jobInfo: {
    flex: 1,
    marginRight: 8,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  docTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: DarkTheme.text,
    flexShrink: 1,
  },
  urgentBadge: {
    backgroundColor: DarkTheme.errorContainer,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  urgentBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: DarkTheme.error,
  },
  jobParams: {
    fontSize: 12,
    color: DarkTheme.textSecondary,
    marginTop: 2,
  },
  liveProgressWrapper: {
    marginTop: 10,
    backgroundColor: DarkTheme.surfaceVariant,
    borderRadius: 8,
    padding: 8,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  progressLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: DarkTheme.text,
  },
  progressPages: {
    fontSize: 11,
    fontWeight: '700',
    color: DarkTheme.primary,
  },
  progressBarBg: {
    height: 6,
    backgroundColor: DarkTheme.surfaceHover,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: DarkTheme.primary,
  },
  recoveryAlert: {
    backgroundColor: DarkTheme.accentContainer,
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: DarkTheme.accent,
  },
  recoveryAlertTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: DarkTheme.accent,
  },
  recoveryAlertText: {
    fontSize: 12,
    color: DarkTheme.text,
    marginTop: 4,
    lineHeight: 16,
  },
  recoveryButton: {
    backgroundColor: DarkTheme.accent,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginTop: 8,
  },
  recoveryButtonText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 12,
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: DarkTheme.border,
  },
  actionBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  actionBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  emptyContainer: {
    alignItems: 'center',
    marginTop: 60,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: DarkTheme.text,
  },
  emptySubtitle: {
    fontSize: 13,
    color: DarkTheme.textSecondary,
    marginTop: 6,
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: DarkTheme.surface,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: DarkTheme.border,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: DarkTheme.text,
  },
  modalSubtitle: {
    fontSize: 13,
    color: DarkTheme.textSecondary,
    marginTop: 6,
    lineHeight: 18,
  },
  inputGroup: {
    marginTop: 14,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: DarkTheme.textSecondary,
    marginBottom: 6,
  },
  input: {
    backgroundColor: DarkTheme.surfaceVariant,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: DarkTheme.text,
    borderWidth: 1,
    borderColor: DarkTheme.border,
    fontSize: 16,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 20,
  },
  modalCancel: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  modalCancelText: {
    color: DarkTheme.textMuted,
    fontWeight: '600',
  },
  modalConfirm: {
    backgroundColor: DarkTheme.primary,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 8,
  },
  modalConfirmText: {
    color: DarkTheme.onPrimary,
    fontWeight: '700',
  },
});
