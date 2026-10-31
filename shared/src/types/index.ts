/**
 * PaperPilot Shared Types & Enums
 */

export type DocumentFormat = 'pdf' | 'docx' | 'jpg' | 'jpeg' | 'png';

export type ProcessingType =
  | 'ORIGINAL'
  | 'MERGED'
  | 'SPLIT'
  | 'EXTRACTED'
  | 'IMAGE_TO_PDF'
  | 'COMPRESSED'
  | 'OCR';

export interface DocumentRecord {
  id: string;
  original_name: string;
  stored_filename: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  sha256_hash: string;
  page_count: number;
  is_processed: boolean;
  original_doc_id?: string | null;
  processing_type?: ProcessingType;
  created_at: string;
  updated_at: string;
}

export type PrinterStatus =
  | 'DISCONNECTED'
  | 'NETWORK_DETECTED'
  | 'DISCOVERING'
  | 'AVAILABLE'
  | 'BUSY'
  | 'ERROR'
  | 'UNKNOWN';

export type PrinterProtocol = 'ipp' | 'raw' | 'android_print_service' | 'airprint';

export interface PrinterCapabilities {
  supports_color: boolean;
  supports_duplex_manual: boolean;
  supports_duplex_auto: boolean;
  supported_media_sizes: string[];
  supported_pdls: string[];
  max_copies: number;
  uri_supported?: string;
  firmware_version?: string;
}

export interface PrinterRecord {
  id: string;
  name: string;
  model: string;
  ip_address: string;
  port: number;
  protocol: PrinterProtocol;
  is_default: boolean;
  wifi_direct_ssid?: string;
  bssid?: string;
  capabilities: PrinterCapabilities;
  status: PrinterStatus;
  last_seen?: string;
  created_at: string;
  updated_at: string;
}

export type JobStatus =
  | 'PENDING'
  | 'WAITING_FOR_PRINTER'
  | 'VALIDATING'
  | 'SUBMITTED'
  | 'PRINTING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'INTERRUPTED'
  | 'FAILED'
  | 'CANCELLED'
  | 'NEEDS_CONFIRMATION';

export type ColorMode = 'monochrome' | 'color';
export type DuplexMode = 'simplex' | 'manual_duplex';
export type Orientation = 'portrait' | 'landscape';
export type PaperSize = 'A4' | 'Letter' | 'Legal';

export interface PrintJobRecord {
  id: string;
  document_id: string;
  printer_id: string | null;
  copies: number;
  page_range?: string; // e.g. "1-5, 8, 11-13" or "all"
  paper_size: PaperSize;
  orientation: Orientation;
  color_mode: ColorMode;
  duplex_mode: DuplexMode;
  priority: number; // 1 = highest, 100 = lowest
  queue_position: number;
  status: JobStatus;
  error_message?: string;
  last_confirmed_copy: number;
  last_confirmed_page: number;
  created_at: string;
  updated_at: string;
  // Joined document information
  document?: DocumentRecord;
  printer?: PrinterRecord;
}

export interface PrintJobCheckpointRecord {
  id: string;
  job_id: string;
  copy_index: number;
  completed_page: number;
  total_pages: number;
  verified_at: string;
  is_verified_by_sensor: boolean;
  user_confirmed: boolean;
  notes?: string;
}

export interface PrintJobEventRecord {
  id: string;
  job_id: string;
  event_type: string;
  message: string;
  details?: Record<string, unknown>;
  created_at: string;
}

export interface ApplicationSettingsRecord {
  auto_print_enabled: boolean;
  default_printer_id?: string;
  battery_threshold_percent: number;
  max_retry_count: number;
  retry_delay_seconds: number;
  manual_recovery_required: boolean;
  notification_level: 'all' | 'critical' | 'none';
  rate_per_page_bw_inr: number;
  rate_per_page_color_inr: number;
  paper_sheet_cost_inr: number;
}

export interface CostEstimateRequest {
  page_count: number;
  copies: number;
  color_mode: ColorMode;
  duplex_mode: DuplexMode;
}

export interface CostEstimateResult {
  page_count: number;
  copies: number;
  total_impressions: number;
  estimated_sheets: number;
  cost_per_impression_inr: number;
  ink_cost_inr: number;
  paper_cost_inr: number;
  duplex_savings_inr: number;
  total_estimated_cost_inr: number;
}

export interface ServerHealthResponse {
  status: 'healthy' | 'degraded' | 'error';
  uptime_seconds: number;
  server_timestamp: string;
  memory: {
    rss_mb: number;
    heap_total_mb: number;
    heap_used_mb: number;
    system_free_mb?: number;
    system_total_mb?: number;
  };
  storage: {
    total_space_mb?: number;
    free_space_mb?: number;
    documents_count: number;
    storage_size_mb: number;
  };
  database: {
    status: 'connected' | 'disconnected';
    wal_mode: boolean;
    pending_jobs_count: number;
    active_jobs_count: number;
  };
  printer: {
    active_id?: string;
    status: PrinterStatus;
  };
}

export interface NotificationPayload {
  id: string;
  title: string;
  message: string;
  channel: 'printer_status' | 'print_progress' | 'alerts';
  job_id?: string;
  timestamp: string;
}

/**
 * Socket.IO Real-time Events
 */
export interface ServerToClientEvents {
  'printer:status': (data: { printerId: string; status: PrinterStatus; details?: string }) => void;
  'queue:updated': (data: { jobs: PrintJobRecord[] }) => void;
  'job:progress': (data: {
    jobId: string;
    status: JobStatus;
    copy: number;
    page: number;
    totalPages: number;
  }) => void;
  'job:interrupted': (data: {
    jobId: string;
    checkpoint: PrintJobCheckpointRecord;
    needsConfirmation: boolean;
  }) => void;
  'server:health': (data: ServerHealthResponse) => void;
  'notification:new': (notification: NotificationPayload) => void;
}

export interface ClientToServerEvents {
  'subscribe:printer': (printerId: string) => void;
  'subscribe:queue': () => void;
  'queue:reorder': (data: { jobIdsInOrder: string[] }) => void;
}

export interface AutomationSettings {
  auto_start_on_printer_available: boolean;
  battery_threshold_percent: number;
  pause_on_low_battery: boolean;
  auto_convert_images: boolean;
  auto_compress_threshold_mb: number;
  max_network_retries: number;
}

