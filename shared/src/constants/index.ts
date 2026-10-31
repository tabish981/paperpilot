/**
 * PaperPilot Shared Constants
 */

export const SERVER_CONFIG = {
  DEFAULT_PORT: 5000,
  HOST: '0.0.0.0',
  LOCALHOST: '127.0.0.1',
  MAX_FILE_SIZE_BYTES: 100 * 1024 * 1024, // 100 MB
  ALLOWED_EXTENSIONS: ['.pdf', '.docx', '.jpg', '.jpeg', '.png'] as const,
  STORAGE_DIR: 'storage',
  DOCUMENTS_DIR: 'storage/documents',
  PROCESSED_DIR: 'storage/processed',
  BACKUP_DIR: 'storage/backups',
};

export const HP_SMART_TANK_580 = {
  MODEL_NAME: 'HP Smart Tank 580 All-in-One Printer',
  DEFAULT_WIFI_DIRECT_PREFIX: 'DIRECT-',
  CANDIDATE_GATEWAY_IP: '192.168.223.1',
  PORTS: {
    IPP: 631,
    RAW_JETDIRECT: 9100,
    HTTP_EWS: 80,
    HTTPS_EWS: 443,
  },
  MDNS_SERVICES: [
    '_ipp._tcp.local',
    '_ipps._tcp.local',
    '_pdl-datastream._tcp.local',
    '_http._tcp.local',
    '_printer._tcp.local',
  ],
  SUPPORTED_PDLS: ['application/PCLm', 'image/urf', 'application/vnd.hp-PCL3GUI'],
  DEFAULT_MEDIA: 'A4',
};

export const FILE_SIGNATURES: Record<string, number[]> = {
  PDF: [0x25, 0x50, 0x44, 0x46], // %PDF
  JPEG: [0xff, 0xd8, 0xff],
  PNG: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  DOCX_ZIP: [0x50, 0x4b, 0x03, 0x04], // PK..
};

export const DEFAULT_APPLICATION_SETTINGS = {
  auto_print_enabled: true,
  battery_threshold_percent: 15,
  max_retry_count: 3,
  retry_delay_seconds: 5,
  manual_recovery_required: true,
  notification_level: 'all' as const,
  rate_per_page_bw_inr: 2.0,
  rate_per_page_color_inr: 10.0,
  paper_sheet_cost_inr: 0.5,
};

export const NOTIFICATION_CHANNELS = {
  PRINTER_STATUS: {
    id: 'paperpilot_printer_status',
    name: 'Printer Status & Connectivity',
    description: 'Notifications when HP printer is detected or ready',
    importance: 3, // High
  },
  PRINT_PROGRESS: {
    id: 'paperpilot_print_progress',
    name: 'Print Queue Progress',
    description: 'Real-time print job updates and completion notices',
    importance: 3,
  },
  ALERTS: {
    id: 'paperpilot_alerts',
    name: 'System Alerts & Recovery',
    description: 'Interrupted prints, confirmation requests, and errors',
    importance: 4, // Max
  },
};
