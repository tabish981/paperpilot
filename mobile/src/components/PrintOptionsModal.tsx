import React, { useState, useEffect, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { DarkTheme } from '../theme/colors';
import { DocumentRecord, PrinterRecord, CostEstimateResult } from '@paperpilot/shared';
import { api } from '../services/api';
import { useAppStore } from '../store/useAppStore';

interface PrintOptionsModalProps {
  visible: boolean;
  document: DocumentRecord | null;
  onClose: () => void;
  onPrinted: () => void;
}

type PaperSize = 'A4' | 'A3' | 'Letter' | 'Legal';
type Orientation = 'portrait' | 'landscape';
type ColorMode = 'color' | 'grayscale' | 'monochrome';
type DuplexMode = 'simplex' | 'duplex_long_edge' | 'duplex_short_edge' | 'manual_duplex';

const PAPER_SIZES: PaperSize[] = ['A4', 'A3', 'Letter', 'Legal'];
const ORIENTATIONS: Orientation[] = ['portrait', 'landscape'];
const COLOR_MODES: { value: ColorMode; label: string }[] = [
  { value: 'color', label: 'Color' },
  { value: 'grayscale', label: 'Grayscale' },
  { value: 'monochrome', label: 'B&W' },
];
const DUPLEX_MODES: { value: DuplexMode; label: string }[] = [
  { value: 'simplex', label: 'One-Sided' },
  { value: 'duplex_long_edge', label: 'Long Edge' },
  { value: 'duplex_short_edge', label: 'Short Edge' },
  { value: 'manual_duplex', label: 'Manual Duplex' },
];

export const PrintOptionsModal: React.FC<PrintOptionsModalProps> = ({
  visible,
  document,
  onClose,
  onPrinted,
}) => {
  const { printers, fetchPrinters } = useAppStore();

  const [selectedPrinter, setSelectedPrinter] = useState<PrinterRecord | null>(null);
  const [copies, setCopies] = useState(1);
  const [pageRange, setPageRange] = useState('');
  const [paperSize, setPaperSize] = useState<PaperSize>('A4');
  const [orientation, setOrientation] = useState<Orientation>('portrait');
  const [colorMode, setColorMode] = useState<ColorMode>('monochrome');
  const [duplexMode, setDuplexMode] = useState<DuplexMode>('simplex');
  const [highPriority, setHighPriority] = useState(false);

  const [costEstimate, setCostEstimate] = useState<CostEstimateResult | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (visible) {
      fetchPrinters();
    }
  }, [visible]);

  useEffect(() => {
    const onlinePrinter = printers.find((p) => p.status === 'online');
    if (onlinePrinter && !selectedPrinter) {
      setSelectedPrinter(onlinePrinter);
    }
  }, [printers]);

  useEffect(() => {
    if (!document) return;
    const pageCount = document.page_count || 1;
    const timer = setTimeout(async () => {
      setEstimating(true);
      try {
        const estimate = await api.estimateCost({
          page_count: pageCount,
          copies,
          color_mode: colorMode,
          duplex_mode: duplexMode,
        });
        setCostEstimate(estimate);
      } catch {
        // non-blocking
      } finally {
        setEstimating(false);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [copies, colorMode, duplexMode, document]);

  const handlePrint = useCallback(async () => {
    if (!document) return;
    if (!selectedPrinter) {
      Alert.alert('No Printer Selected', 'Please select or discover a printer first.');
      return;
    }
    setSubmitting(true);
    try {
      await api.enqueueJob({
        document_id: document.id,
        printer_id: selectedPrinter.id,
        copies,
        page_range: pageRange.trim() || undefined,
        paper_size: paperSize,
        orientation,
        color_mode: colorMode,
        duplex_mode: duplexMode,
        priority: highPriority ? 10 : 5,
      });
      Alert.alert(
        'Job Queued ✓',
        `"${document.original_name}" added to print queue.\n${copies} cop${copies > 1 ? 'ies' : 'y'} · ${colorMode} · ${duplexMode}`,
        [{ text: 'OK', onPress: onPrinted }]
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to queue print job';
      Alert.alert('Print Error', msg);
    } finally {
      setSubmitting(false);
    }
  }, [document, selectedPrinter, copies, pageRange, paperSize, orientation, colorMode, duplexMode, highPriority]);

  if (!document) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <View style={styles.dragHandle} />
            <Text style={styles.sheetTitle}>Print Options</Text>
            <Text style={styles.sheetSubtitle} numberOfLines={1}>
              {document.original_name}
            </Text>
          </View>

          <ScrollView contentContainerStyle={styles.sheetBody} showsVerticalScrollIndicator={false}>
            <Text style={styles.sectionLabel}>PRINTER</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.printerRow}>
              {printers.map((printer) => (
                <TouchableOpacity
                  key={printer.id}
                  style={[
                    styles.printerChip,
                    selectedPrinter?.id === printer.id && styles.printerChipActive,
                    printer.status !== 'online' && styles.printerChipOffline,
                  ]}
                  onPress={() => setSelectedPrinter(printer)}
                >
                  <Text style={styles.printerChipIcon}>
                    {printer.status === 'online' ? '🟢' : '🔴'}
                  </Text>
                  <Text
                    style={[
                      styles.printerChipText,
                      selectedPrinter?.id === printer.id && styles.printerChipTextActive,
                    ]}
                    numberOfLines={1}
                  >
                    {printer.name}
                  </Text>
                </TouchableOpacity>
              ))}
              {printers.length === 0 && (
                <Text style={styles.noPrinterText}>No printers found. Go to Printers tab.</Text>
              )}
            </ScrollView>

            <View style={styles.rowGroup}>
              <View style={styles.halfInput}>
                <Text style={styles.sectionLabel}>COPIES</Text>
                <View style={styles.counterRow}>
                  <TouchableOpacity
                    style={styles.counterBtn}
                    onPress={() => setCopies(Math.max(1, copies - 1))}
                  >
                    <Text style={styles.counterBtnText}>−</Text>
                  </TouchableOpacity>
                  <Text style={styles.counterValue}>{copies}</Text>
                  <TouchableOpacity
                    style={styles.counterBtn}
                    onPress={() => setCopies(Math.min(99, copies + 1))}
                  >
                    <Text style={styles.counterBtnText}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <View style={styles.halfInput}>
                <Text style={styles.sectionLabel}>PAGE RANGE</Text>
                <TextInput
                  style={styles.rangeInput}
                  placeholder="e.g. 1-3,5"
                  placeholderTextColor={DarkTheme.textMuted}
                  value={pageRange}
                  onChangeText={setPageRange}
                  keyboardType="numbers-and-punctuation"
                />
                <Text style={styles.rangeHint}>
                  {document.page_count ? `${document.page_count} pages total` : 'All pages'}
                </Text>
              </View>
            </View>

            <Text style={styles.sectionLabel}>PAPER SIZE</Text>
            <View style={styles.chipRow}>
              {PAPER_SIZES.map((size) => (
                <TouchableOpacity
                  key={size}
                  style={[styles.optionChip, paperSize === size && styles.optionChipActive]}
                  onPress={() => setPaperSize(size)}
                >
                  <Text style={[styles.optionChipText, paperSize === size && styles.optionChipTextActive]}>
                    {size}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.sectionLabel}>ORIENTATION</Text>
            <View style={styles.chipRow}>
              {ORIENTATIONS.map((o) => (
                <TouchableOpacity
                  key={o}
                  style={[styles.optionChip, orientation === o && styles.optionChipActive]}
                  onPress={() => setOrientation(o)}
                >
                  <Text style={[styles.optionChipText, orientation === o && styles.optionChipTextActive]}>
                    {o === 'portrait' ? '↕ Portrait' : '↔ Landscape'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.sectionLabel}>COLOR MODE</Text>
            <View style={styles.chipRow}>
              {COLOR_MODES.map((c) => (
                <TouchableOpacity
                  key={c.value}
                  style={[styles.optionChip, colorMode === c.value && styles.optionChipActive]}
                  onPress={() => setColorMode(c.value)}
                >
                  <Text style={[styles.optionChipText, colorMode === c.value && styles.optionChipTextActive]}>
                    {c.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.sectionLabel}>DUPLEX / SIDES</Text>
            <View style={styles.chipRow}>
              {DUPLEX_MODES.map((d) => (
                <TouchableOpacity
                  key={d.value}
                  style={[styles.optionChip, duplexMode === d.value && styles.optionChipActive]}
                  onPress={() => setDuplexMode(d.value)}
                >
                  <Text style={[styles.optionChipText, duplexMode === d.value && styles.optionChipTextActive]}>
                    {d.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {duplexMode === 'manual_duplex' && (
              <View style={styles.infoBox}>
                <Text style={styles.infoText}>
                  ⚠ Manual Duplex: Odd pages print first. You'll be prompted to re-feed before even pages print.
                </Text>
              </View>
            )}

            <View style={styles.priorityRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.settingLabel}>High Priority</Text>
                <Text style={styles.settingDescription}>Push to front of print queue</Text>
              </View>
              <Switch
                value={highPriority}
                onValueChange={setHighPriority}
                trackColor={{ false: DarkTheme.surfaceVariant, true: DarkTheme.primary }}
                thumbColor={DarkTheme.text}
              />
            </View>

            <View style={styles.costBox}>
              <Text style={styles.costTitle}>Estimated Cost</Text>
              {estimating ? (
                <ActivityIndicator size="small" color={DarkTheme.primary} />
              ) : costEstimate ? (
                <View style={styles.costGrid}>
                  <View style={styles.costCell}>
                    <Text style={styles.costCellLabel}>Ink</Text>
                    <Text style={styles.costCellValue}>₹{costEstimate.ink_cost.toFixed(2)}</Text>
                  </View>
                  <View style={styles.costCell}>
                    <Text style={styles.costCellLabel}>Paper</Text>
                    <Text style={styles.costCellValue}>₹{costEstimate.paper_cost.toFixed(2)}</Text>
                  </View>
                  <View style={[styles.costCell, styles.costCellTotal]}>
                    <Text style={styles.costCellLabel}>Total</Text>
                    <Text style={[styles.costCellValue, styles.costCellTotalValue]}>
                      ₹{costEstimate.total_cost.toFixed(2)}
                    </Text>
                  </View>
                </View>
              ) : (
                <Text style={styles.costPlaceholder}>Calculating...</Text>
              )}
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={submitting}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.printBtn, submitting && styles.printBtnDisabled]}
              onPress={handlePrint}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator size="small" color={DarkTheme.onPrimary} />
              ) : (
                <Text style={styles.printBtnText}>🖨  Print Now</Text>
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
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: DarkTheme.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    paddingBottom: 20,
  },
  sheetHeader: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: DarkTheme.border,
  },
  dragHandle: {
    width: 36,
    height: 4,
    backgroundColor: DarkTheme.border,
    borderRadius: 2,
    marginBottom: 10,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: DarkTheme.text,
  },
  sheetSubtitle: {
    fontSize: 12,
    color: DarkTheme.textMuted,
    marginTop: 4,
  },
  sheetBody: {
    padding: 20,
    paddingBottom: 10,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: DarkTheme.textSecondary,
    letterSpacing: 0.8,
    marginBottom: 8,
    marginTop: 14,
  },
  printerRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  printerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: DarkTheme.surfaceVariant,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginRight: 8,
    borderWidth: 1,
    borderColor: DarkTheme.border,
    maxWidth: 180,
  },
  printerChipActive: {
    borderColor: DarkTheme.primary,
    backgroundColor: `${DarkTheme.primary}22`,
  },
  printerChipOffline: {
    opacity: 0.5,
  },
  printerChipIcon: {
    fontSize: 12,
    marginRight: 6,
  },
  printerChipText: {
    fontSize: 13,
    color: DarkTheme.textSecondary,
    fontWeight: '600',
    flexShrink: 1,
  },
  printerChipTextActive: {
    color: DarkTheme.primary,
  },
  noPrinterText: {
    fontSize: 12,
    color: DarkTheme.textMuted,
    fontStyle: 'italic',
    alignSelf: 'center',
  },
  rowGroup: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 4,
  },
  halfInput: {
    flex: 1,
  },
  counterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: DarkTheme.surfaceVariant,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: DarkTheme.border,
    overflow: 'hidden',
  },
  counterBtn: {
    padding: 10,
    paddingHorizontal: 14,
  },
  counterBtnText: {
    fontSize: 18,
    fontWeight: '700',
    color: DarkTheme.primary,
  },
  counterValue: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '800',
    color: DarkTheme.text,
  },
  rangeInput: {
    backgroundColor: DarkTheme.surfaceVariant,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: DarkTheme.border,
    color: DarkTheme.text,
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 13,
  },
  rangeHint: {
    fontSize: 10,
    color: DarkTheme.textMuted,
    marginTop: 4,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
  },
  optionChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: DarkTheme.surfaceVariant,
    borderWidth: 1,
    borderColor: DarkTheme.border,
  },
  optionChipActive: {
    backgroundColor: `${DarkTheme.primary}22`,
    borderColor: DarkTheme.primary,
  },
  optionChipText: {
    fontSize: 13,
    color: DarkTheme.textSecondary,
    fontWeight: '600',
  },
  optionChipTextActive: {
    color: DarkTheme.primary,
    fontWeight: '800',
  },
  infoBox: {
    backgroundColor: `${DarkTheme.warning}18`,
    borderRadius: 8,
    padding: 10,
    marginTop: 8,
    borderWidth: 1,
    borderColor: `${DarkTheme.warning}50`,
  },
  infoText: {
    fontSize: 12,
    color: DarkTheme.warning,
    lineHeight: 18,
  },
  priorityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    marginTop: 6,
    borderTopWidth: 1,
    borderTopColor: DarkTheme.border,
  },
  settingLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: DarkTheme.text,
  },
  settingDescription: {
    fontSize: 11,
    color: DarkTheme.textSecondary,
    marginTop: 2,
  },
  costBox: {
    backgroundColor: DarkTheme.surfaceVariant,
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
    borderWidth: 1,
    borderColor: DarkTheme.border,
  },
  costTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: DarkTheme.textSecondary,
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  costGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  costCell: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: DarkTheme.surface,
    borderRadius: 8,
    padding: 8,
  },
  costCellTotal: {
    backgroundColor: `${DarkTheme.primary}18`,
    borderWidth: 1,
    borderColor: `${DarkTheme.primary}40`,
  },
  costCellLabel: {
    fontSize: 10,
    color: DarkTheme.textMuted,
    fontWeight: '600',
    marginBottom: 2,
  },
  costCellValue: {
    fontSize: 15,
    fontWeight: '800',
    color: DarkTheme.text,
  },
  costCellTotalValue: {
    color: DarkTheme.primary,
  },
  costPlaceholder: {
    fontSize: 12,
    color: DarkTheme.textMuted,
    textAlign: 'center',
  },
  footer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: DarkTheme.border,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: DarkTheme.surfaceVariant,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: DarkTheme.border,
  },
  cancelBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: DarkTheme.textSecondary,
  },
  printBtn: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: DarkTheme.primary,
    alignItems: 'center',
    elevation: 6,
  },
  printBtnDisabled: {
    opacity: 0.6,
  },
  printBtnText: {
    fontSize: 16,
    fontWeight: '800',
    color: DarkTheme.onPrimary,
    letterSpacing: 0.3,
  },
});
