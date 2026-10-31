import { create } from 'zustand';
import {
  DocumentRecord,
  PrintJobRecord,
  PrinterRecord,
  ServerHealthResponse,
  PrinterStatus,
} from '@paperpilot/shared';
import { api } from '../services/api';
import { mobileSocket } from '../services/socket';

interface AppState {
  // Data
  documents: DocumentRecord[];
  queue: PrintJobRecord[];
  printers: PrinterRecord[];
  serverHealth: ServerHealthResponse | null;
  serverConnected: boolean;
  activeJobProgress: {
    jobId: string;
    status: string;
    copy: number;
    page: number;
    totalPages: number;
  } | null;

  uploadProgress: number | null;
  isQueuePaused: boolean;

  // Actions
  fetchDocuments: (params?: {
    search?: string;
    filter?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) => Promise<void>;
  setUploadProgress: (progress: number | null) => void;
  fetchQueue: () => Promise<void>;
  fetchPrinters: () => Promise<void>;
  checkServerHealth: () => Promise<void>;
  setPrinterStatus: (printerId: string, status: PrinterStatus) => void;
  updateJobProgress: (data: {
    jobId: string;
    status: string;
    copy: number;
    page: number;
    totalPages: number;
  }) => void;
  initializeSocketListeners: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  documents: [],
  queue: [],
  printers: [],
  serverHealth: null,
  serverConnected: false,
  activeJobProgress: null,
  uploadProgress: null,
  isQueuePaused: false,

  fetchDocuments: async (params) => {
    try {
      const data = await api.getDocuments(params);
      set({ documents: data.documents });
    } catch (err) {
      console.warn('[Store] Failed to fetch documents:', err);
    }
  },

  setUploadProgress: (progress) => {
    set({ uploadProgress: progress });
  },

  fetchQueue: async () => {
    try {
      const data = await api.getQueue();
      set({ queue: data.queue, isQueuePaused: data.isQueuePaused });
    } catch (err) {
      console.warn('[Store] Failed to fetch queue:', err);
    }
  },

  fetchPrinters: async () => {
    try {
      const data = await api.getPrinters();
      set({ printers: data.printers });
    } catch (err) {
      console.warn('[Store] Failed to fetch printers:', err);
    }
  },

  checkServerHealth: async () => {
    try {
      const health = await api.getServerHealth();
      set({ serverHealth: health, serverConnected: true });
    } catch {
      set({ serverConnected: false });
    }
  },

  setPrinterStatus: (printerId: string, status: PrinterStatus) => {
    set((state) => ({
      printers: state.printers.map((p) => (p.id === printerId ? { ...p, status } : p)),
    }));
  },

  updateJobProgress: (progress) => {
    set({ activeJobProgress: progress });
  },

  initializeSocketListeners: () => {
    const socket = mobileSocket.getSocket();
    if (!socket) return;

    socket.on('queue:updated', ({ jobs }) => {
      set({ queue: jobs });
    });

    socket.on('printer:status', ({ printerId, status }) => {
      get().setPrinterStatus(printerId, status);
    });

    socket.on('job:progress', (data) => {
      get().updateJobProgress(data);
    });

    socket.on('server:health', (health) => {
      set({ serverHealth: health, serverConnected: true });
    });
  },
}));
