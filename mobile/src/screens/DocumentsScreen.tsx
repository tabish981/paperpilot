import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  Alert,
  Modal,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { DarkTheme } from '../theme/colors';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { StatusBadge } from '../components/StatusBadge';
import { useAppStore } from '../store/useAppStore';
import { api } from '../services/api';
import { DocumentRecord } from '@paperpilot/shared';
import { PrintOptionsModal } from '../components/PrintOptionsModal';

export const DocumentsScreen: React.FC = () => {
  const { documents, fetchDocuments, fetchQueue } = useAppStore();

  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'pdf' | 'image' | 'docx' | 'processed'>('all');
  const [sortBy, setSortBy] = useState<'created_at' | 'original_name' | 'file_size' | 'page_count'>('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [refreshing, setRefreshing] = useState(false);

  // Modals state
  const [printDoc, setPrintDoc] = useState<DocumentRecord | null>(null);
  const [previewDoc, setPreviewDoc] = useState<DocumentRecord | null>(null);
  const [renameDoc, setRenameDoc] = useState<DocumentRecord | null>(null);
  const [renameText, setRenameText] = useState('');

  // Toolbox state
  const [showToolbox, setShowToolbox] = useState(false);
  const [toolboxTab, setToolboxTab] = useState<'merge' | 'extract' | 'image2pdf'>('merge');
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [customRange, setCustomRange] = useState('1-2');
  const [customOutputName, setCustomOutputName] = useState('');

  const loadDocs = async () => {
    setRefreshing(true);
    await fetchDocuments({
      search: search.trim() || undefined,
      filter: activeFilter,
      sortBy,
      sortOrder,
    });
    setRefreshing(false);
  };

  useEffect(() => {
    loadDocs();
  }, [activeFilter, sortBy, sortOrder]);

  const handleSearchSubmit = () => {
    loadDocs();
  };

  const handlePrint = (doc: DocumentRecord) => {
    setPrintDoc(doc);
  };

  const handleRenameConfirm = async () => {
    if (!renameDoc || !renameText.trim()) return;
    try {
      await api.renameDocument(renameDoc.id, renameText.trim());
      setRenameDoc(null);
      await loadDocs();
      Alert.alert('Renamed', 'Document renamed successfully.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Rename failed';
      Alert.alert('Rename Error', msg);
    }
  };

  const handleDelete = (doc: DocumentRecord) => {
    Alert.alert('Delete Document', `Are you sure you want to delete ${doc.original_name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteDocument(doc.id);
            await loadDocs();
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Delete failed';
            Alert.alert('Error', msg);
          }
        },
      },
    ]);
  };

  const handleCompress = async (doc: DocumentRecord) => {
    try {
      const res = await api.compressDocument(doc.id);
      await loadDocs();
      Alert.alert(
        'Compression Complete',
        `Original: ${(res.result.originalSize / 1024).toFixed(1)} KB\nCompressed: ${(res.result.compressedSize / 1024).toFixed(1)} KB\nSaved: ${res.result.percentSaved}%`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Compression failed';
      Alert.alert('Error', msg);
    }
  };

  const handleExecuteToolbox = async () => {
    try {
      if (toolboxTab === 'merge') {
        if (selectedDocIds.length < 2) {
          Alert.alert('Selection Error', 'Please select at least 2 PDF documents to merge.');
          return;
        }
        await api.mergeDocuments(selectedDocIds, customOutputName.trim() || undefined);
        Alert.alert('Success', 'PDFs merged successfully!');
      } else if (toolboxTab === 'extract') {
        if (selectedDocIds.length !== 1) {
          Alert.alert('Selection Error', 'Please select exactly 1 PDF to extract pages from.');
          return;
        }
        await api.extractPages(selectedDocIds[0], customRange.trim(), customOutputName.trim() || undefined);
        Alert.alert('Success', 'Pages extracted into a new PDF!');
      } else if (toolboxTab === 'image2pdf') {
        if (selectedDocIds.length < 1) {
          Alert.alert('Selection Error', 'Please select at least 1 image to convert to PDF.');
          return;
        }
        await api.convertImageToPdf(selectedDocIds, customOutputName.trim() || undefined, 'A4');
        Alert.alert('Success', 'Image(s) converted to print-ready A4 PDF!');
      }

      setShowToolbox(false);
      setSelectedDocIds([]);
      setCustomOutputName('');
      await loadDocs();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Operation failed';
      Alert.alert('Toolbox Error', msg);
    }
  };

  const toggleSelectDoc = (id: string) => {
    if (selectedDocIds.includes(id)) {
      setSelectedDocIds(selectedDocIds.filter((item) => item !== id));
    } else {
      setSelectedDocIds([...selectedDocIds, id]);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const filters: Array<{ id: typeof activeFilter; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'pdf', label: 'PDFs' },
    { id: 'image', label: 'Images' },
    { id: 'docx', label: 'DOCX' },
    { id: 'processed', label: 'Processed' },
  ];

  return (
    <View style={styles.screen}>
      <Header title="Documents" subtitle={`${documents.length} files available locally`} />

      {/* Top Search & Actions */}
      <View style={styles.topBar}>
        <View style={styles.searchWrapper}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search documents..."
            placeholderTextColor={DarkTheme.textMuted}
            value={search}
            onChangeText={setSearch}
            onSubmitEditing={handleSearchSubmit}
          />
        </View>

        <TouchableOpacity style={styles.toolBtn} onPress={() => setShowToolbox(true)}>
          <Text style={styles.toolBtnText}>PDF Tools ▾</Text>
        </TouchableOpacity>
      </View>

      {/* Filter Tabs */}
      <View style={styles.filterBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
          {filters.map((f) => (
            <TouchableOpacity
              key={f.id}
              style={[styles.filterChip, activeFilter === f.id && styles.filterChipActive]}
              onPress={() => setActiveFilter(f.id)}
            >
              <Text
                style={[styles.filterChipText, activeFilter === f.id && styles.filterChipTextActive]}
              >
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Document Catalog */}
      <FlatList
        data={documents}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={loadDocs} tintColor={DarkTheme.primary} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>No Documents Found</Text>
            <Text style={styles.emptySubtitle}>
              Share documents from any app via the Android Share-Sheet or use PDF Tools to generate print files.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Card style={styles.docCard}>
            <View style={styles.docRow}>
              <View style={styles.typeBadge}>
                <Text style={styles.typeBadgeText}>
                  {item.mime_type.split('/')[1]?.toUpperCase().replace('VND.OPENXMLFORMATS-OFFICEDOCUMENT.WORDPROCESSINGML.DOCUMENT', 'DOCX')}
                </Text>
              </View>

              <View style={styles.docInfo}>
                <Text style={styles.docTitle} numberOfLines={1}>
                  {item.original_name}
                </Text>
                <Text style={styles.docMeta}>
                  {item.page_count} {item.page_count === 1 ? 'page' : 'pages'} • {formatFileSize(item.file_size)}
                </Text>
              </View>

              {item.is_processed ? (
                <View style={styles.procBadge}>
                  <Text style={styles.procBadgeText}>{item.processing_type || 'PROCESSED'}</Text>
                </View>
              ) : null}
            </View>

            {/* Actions Bar */}
            <View style={styles.cardActions}>
              <TouchableOpacity style={styles.metaBtn} onPress={() => setPreviewDoc(item)}>
                <Text style={styles.metaBtnText}>Preview / Info</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.metaBtn}
                onPress={() => {
                  setRenameDoc(item);
                  setRenameText(item.original_name);
                }}
              >
                <Text style={styles.metaBtnText}>Rename</Text>
              </TouchableOpacity>

              {item.mime_type === 'application/pdf' && (
                <TouchableOpacity style={styles.metaBtn} onPress={() => handleCompress(item)}>
                  <Text style={styles.metaBtnText}>Compress</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity style={styles.printBtn} onPress={() => handlePrint(item)}>
                <Text style={styles.printBtnText}>Print</Text>
              </TouchableOpacity>
            </View>
          </Card>
        )}
      />

      {/* PDF Toolbox Modal */}
      <Modal visible={showToolbox} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>PaperPilot PDF Toolbox</Text>
            <Text style={styles.modalSubtitle}>
              Local-first document processing. Manipulate files on-device with zero internet needed.
            </Text>

            {/* Tool Tabs */}
            <View style={styles.toolTabRow}>
              <TouchableOpacity
                style={[styles.toolTab, toolboxTab === 'merge' && styles.toolTabActive]}
                onPress={() => setToolboxTab('merge')}
              >
                <Text style={[styles.toolTabText, toolboxTab === 'merge' && styles.toolTabTextActive]}>
                  Merge PDFs
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.toolTab, toolboxTab === 'extract' && styles.toolTabActive]}
                onPress={() => setToolboxTab('extract')}
              >
                <Text style={[styles.toolTabText, toolboxTab === 'extract' && styles.toolTabTextActive]}>
                  Extract Pages
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.toolTab, toolboxTab === 'image2pdf' && styles.toolTabActive]}
                onPress={() => setToolboxTab('image2pdf')}
              >
                <Text style={[styles.toolTabText, toolboxTab === 'image2pdf' && styles.toolTabTextActive]}>
                  Image to PDF
                </Text>
              </TouchableOpacity>
            </View>

            {/* Inputs based on tool */}
            {toolboxTab === 'extract' && (
              <View style={styles.toolInputGroup}>
                <Text style={styles.inputLabel}>Page Range to Extract (e.g. 1-2, 5):</Text>
                <TextInput
                  style={styles.modalInput}
                  value={customRange}
                  onChangeText={setCustomRange}
                  placeholder="1-2"
                  placeholderTextColor={DarkTheme.textMuted}
                />
              </View>
            )}

            <View style={styles.toolInputGroup}>
              <Text style={styles.inputLabel}>Output File Name (Optional):</Text>
              <TextInput
                style={styles.modalInput}
                value={customOutputName}
                onChangeText={setCustomOutputName}
                placeholder="e.g. Processed_Document.pdf"
                placeholderTextColor={DarkTheme.textMuted}
              />
            </View>

            <Text style={styles.selectHeader}>Select Documents to Process ({selectedDocIds.length} selected):</Text>
            <ScrollView style={styles.selectList}>
              {documents
                .filter((d) =>
                  toolboxTab === 'image2pdf'
                    ? d.mime_type.startsWith('image/')
                    : d.mime_type === 'application/pdf'
                )
                .map((d) => {
                  const selected = selectedDocIds.includes(d.id);
                  return (
                    <TouchableOpacity
                      key={d.id}
                      style={[styles.selectItem, selected && styles.selectItemActive]}
                      onPress={() => toggleSelectDoc(d.id)}
                    >
                      <Text style={[styles.selectText, selected && { color: DarkTheme.primary }]}>
                        {selected ? '✓ ' : '○ '} {d.original_name} ({d.page_count} pgs)
                      </Text>
                    </TouchableOpacity>
                  );
                })}
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => {
                  setShowToolbox(false);
                  setSelectedDocIds([]);
                }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirm} onPress={handleExecuteToolbox}>
                <Text style={styles.modalConfirmText}>Execute Tool</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Document Preview & Metadata Modal */}
      <Modal visible={!!previewDoc} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Document Metadata</Text>
            {previewDoc && (
              <View style={styles.metaDetails}>
                <Text style={styles.metaProp}>Filename: <Text style={styles.metaVal}>{previewDoc.original_name}</Text></Text>
                <Text style={styles.metaProp}>Format: <Text style={styles.metaVal}>{previewDoc.mime_type}</Text></Text>
                <Text style={styles.metaProp}>Page Count: <Text style={styles.metaVal}>{previewDoc.page_count} pages</Text></Text>
                <Text style={styles.metaProp}>File Size: <Text style={styles.metaVal}>{formatFileSize(previewDoc.file_size)}</Text></Text>
                <Text style={styles.metaProp}>SHA-256 Hash: <Text style={styles.hashText}>{previewDoc.sha256_hash}</Text></Text>
                <Text style={styles.metaProp}>Type: <Text style={styles.metaVal}>{previewDoc.processing_type || 'ORIGINAL'}</Text></Text>
              </View>
            )}
            <View style={styles.modalActions}>
              {previewDoc && (
                <TouchableOpacity
                  style={[styles.modalCancel, { backgroundColor: DarkTheme.errorContainer, borderRadius: 8 }]}
                  onPress={() => {
                    const doc = previewDoc;
                    setPreviewDoc(null);
                    handleDelete(doc);
                  }}
                >
                  <Text style={[styles.modalCancelText, { color: DarkTheme.error }]}>Delete</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.modalConfirm} onPress={() => setPreviewDoc(null)}>
                <Text style={styles.modalConfirmText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Rename Dialog Modal */}
      <Modal visible={!!renameDoc} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Rename Document</Text>
            <TextInput
              style={[styles.modalInput, { marginTop: 12 }]}
              value={renameText}
              onChangeText={setRenameText}
              placeholder="Enter new filename"
              placeholderTextColor={DarkTheme.textMuted}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setRenameDoc(null)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirm} onPress={handleRenameConfirm}>
                <Text style={styles.modalConfirmText}>Save Name</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Print Options Bottom Sheet Modal */}
      <PrintOptionsModal
        visible={!!printDoc}
        document={printDoc}
        onClose={() => setPrintDoc(null)}
        onPrinted={async () => {
          setPrintDoc(null);
          await fetchQueue();
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: DarkTheme.background,
  },
  topBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  searchWrapper: {
    flex: 1,
  },
  searchInput: {
    backgroundColor: DarkTheme.surfaceVariant,
    color: DarkTheme.text,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: DarkTheme.border,
    fontSize: 14,
  },
  toolBtn: {
    backgroundColor: DarkTheme.primaryContainer,
    borderWidth: 1,
    borderColor: DarkTheme.primary,
    borderRadius: 10,
    paddingHorizontal: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  toolBtnText: {
    color: DarkTheme.primary,
    fontWeight: '700',
    fontSize: 12,
  },
  filterBar: {
    paddingBottom: 6,
  },
  filterScroll: {
    paddingHorizontal: 16,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: DarkTheme.surfaceVariant,
    borderWidth: 1,
    borderColor: DarkTheme.border,
  },
  filterChipActive: {
    backgroundColor: DarkTheme.primary,
    borderColor: DarkTheme.primary,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: DarkTheme.textSecondary,
  },
  filterChipTextActive: {
    color: DarkTheme.onPrimary,
    fontWeight: '700',
  },
  list: {
    padding: 16,
    paddingBottom: 40,
  },
  docCard: {
    marginBottom: 10,
  },
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  typeBadge: {
    backgroundColor: DarkTheme.surfaceVariant,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: DarkTheme.border,
    marginRight: 10,
  },
  typeBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: DarkTheme.primary,
  },
  docInfo: {
    flex: 1,
  },
  docTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: DarkTheme.text,
  },
  docMeta: {
    fontSize: 12,
    color: DarkTheme.textSecondary,
    marginTop: 2,
  },
  procBadge: {
    backgroundColor: DarkTheme.secondaryContainer,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  procBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: DarkTheme.secondary,
  },
  cardActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: DarkTheme.border,
  },
  metaBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  metaBtnText: {
    color: DarkTheme.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
  printBtn: {
    backgroundColor: DarkTheme.primary,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 6,
  },
  printBtnText: {
    color: DarkTheme.onPrimary,
    fontWeight: '700',
    fontSize: 12,
  },
  emptyContainer: {
    alignItems: 'center',
    marginTop: 60,
    paddingHorizontal: 30,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: DarkTheme.text,
  },
  emptySubtitle: {
    fontSize: 13,
    color: DarkTheme.textSecondary,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    padding: 20,
  },
  modalSheet: {
    backgroundColor: DarkTheme.surface,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: DarkTheme.border,
    maxHeight: '85%',
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
    fontSize: 12,
    color: DarkTheme.textSecondary,
    marginTop: 4,
    lineHeight: 16,
  },
  toolTabRow: {
    flexDirection: 'row',
    backgroundColor: DarkTheme.surfaceVariant,
    borderRadius: 10,
    padding: 4,
    marginVertical: 14,
    gap: 4,
  },
  toolTab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  toolTabActive: {
    backgroundColor: DarkTheme.primary,
  },
  toolTabText: {
    fontSize: 11,
    fontWeight: '700',
    color: DarkTheme.textSecondary,
  },
  toolTabTextActive: {
    color: DarkTheme.onPrimary,
  },
  toolInputGroup: {
    marginBottom: 10,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: DarkTheme.textSecondary,
    marginBottom: 4,
  },
  modalInput: {
    backgroundColor: DarkTheme.surfaceVariant,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: DarkTheme.text,
    borderWidth: 1,
    borderColor: DarkTheme.border,
    fontSize: 14,
  },
  selectHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: DarkTheme.textSecondary,
    marginTop: 6,
    marginBottom: 4,
  },
  selectList: {
    maxHeight: 150,
    marginVertical: 6,
  },
  selectItem: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: DarkTheme.border,
    marginBottom: 4,
  },
  selectItemActive: {
    borderColor: DarkTheme.primary,
    backgroundColor: DarkTheme.primaryContainer,
  },
  selectText: {
    fontSize: 12,
    color: DarkTheme.text,
  },
  metaDetails: {
    marginTop: 14,
    gap: 8,
  },
  metaProp: {
    fontSize: 13,
    color: DarkTheme.textSecondary,
  },
  metaVal: {
    color: DarkTheme.text,
    fontWeight: '600',
  },
  hashText: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: DarkTheme.primary,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 20,
  },
  modalCancel: {
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  modalCancelText: {
    color: DarkTheme.textMuted,
    fontWeight: '600',
  },
  modalConfirm: {
    backgroundColor: DarkTheme.primary,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  modalConfirmText: {
    color: DarkTheme.onPrimary,
    fontWeight: '700',
  },
});
