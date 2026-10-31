/**
 * PaperPilot Shared Zod Validation Schemas
 */

import { z } from 'zod';

export const DocumentUploadSchema = z.object({
  original_name: z.string().min(1).max(255),
  file_size: z.number().int().positive().max(100 * 1024 * 1024),
  mime_type: z.string().min(3).max(100),
});

export const RenameDocumentSchema = z.object({
  new_name: z.string().min(1).max(255),
});

export const MergeDocumentsSchema = z.object({
  documentIds: z.array(z.string().uuid()).min(2, 'At least 2 documents are required to merge'),
  outputName: z.string().min(1).max(255).optional(),
});

export const SplitDocumentSchema = z.object({
  documentId: z.string().uuid(),
  pageRanges: z.array(z.string().regex(/^(\d+)(-\d+)?$/, 'Invalid page range')).min(1),
});

export const ExtractPagesSchema = z.object({
  documentId: z.string().uuid(),
  pageRange: z.string().regex(/^(\d+(-\d+)?)(,\s*\d+(-\d+)?)*$/, 'Invalid page range (e.g. 1-3, 5, 8-10)'),
  outputName: z.string().min(1).max(255).optional(),
});

export const ImageToPdfSchema = z.object({
  documentIds: z.array(z.string().uuid()).min(1, 'At least one image is required'),
  outputName: z.string().min(1).max(255).optional(),
  pageSize: z.enum(['A4', 'fit_image']).default('A4'),
});

export const CompressDocumentSchema = z.object({
  documentId: z.string().uuid(),
});

export const ReorderQueueSchema = z.object({
  jobIdsInOrder: z.array(z.string().uuid()).min(1),
});

export const CreatePrintJobSchema = z.object({
  document_id: z.string().uuid(),
  printer_id: z.string().uuid().nullable().optional(),
  copies: z.number().int().min(1).max(99).default(1),
  page_range: z
    .string()
    .regex(/^(\d+(-\d+)?)(,\s*\d+(-\d+)?)*$|^all$/i, 'Invalid page range format (e.g. 1-5, 8, all)')
    .optional()
    .default('all'),
  paper_size: z.enum(['A4', 'Letter', 'Legal']).default('A4'),
  orientation: z.enum(['portrait', 'landscape']).default('portrait'),
  color_mode: z.enum(['monochrome', 'color']).default('monochrome'),
  duplex_mode: z.enum(['simplex', 'manual_duplex']).default('simplex'),
  priority: z.number().int().min(1).max(100).default(50),
});

export const UpdatePrintJobSchema = z.object({
  copies: z.number().int().min(1).max(99).optional(),
  page_range: z.string().optional(),
  paper_size: z.enum(['A4', 'Letter', 'Legal']).optional(),
  orientation: z.enum(['portrait', 'landscape']).optional(),
  color_mode: z.enum(['monochrome', 'color']).optional(),
  duplex_mode: z.enum(['simplex', 'manual_duplex']).optional(),
  priority: z.number().int().min(1).max(100).optional(),
  printer_id: z.string().uuid().nullable().optional(),
});

export const RegisterPrinterSchema = z.object({
  name: z.string().min(1).max(100),
  model: z.string().min(1).max(100).default('HP Smart Tank 580'),
  ip_address: z.string().ip({ version: 'v4' }),
  port: z.number().int().min(1).max(65535).default(631),
  protocol: z.enum(['ipp', 'raw', 'android_print_service', 'airprint']).default('ipp'),
  is_default: z.boolean().default(false),
  wifi_direct_ssid: z.string().optional(),
  bssid: z.string().optional(),
  capabilities: z
    .object({
      supports_color: z.boolean().default(true),
      supports_duplex_manual: z.boolean().default(true),
      supports_duplex_auto: z.boolean().default(false),
      supported_media_sizes: z.array(z.string()).default(['A4', 'Letter', 'Legal']),
      supported_pdls: z
        .array(z.string())
        .default(['application/PCLm', 'image/urf', 'application/vnd.hp-PCL3GUI']),
      max_copies: z.number().int().default(99),
      uri_supported: z.string().optional(),
      firmware_version: z.string().optional(),
    })
    .default({}),
});

export const UpdateApplicationSettingsSchema = z.object({
  auto_print_enabled: z.boolean().optional(),
  default_printer_id: z.string().uuid().optional().nullable(),
  battery_threshold_percent: z.number().int().min(5).max(100).optional(),
  max_retry_count: z.number().int().min(0).max(10).optional(),
  retry_delay_seconds: z.number().int().min(1).max(60).optional(),
  manual_recovery_required: z.boolean().optional(),
  notification_level: z.enum(['all', 'critical', 'none']).optional(),
  rate_per_page_bw_inr: z.number().min(0).optional(),
  rate_per_page_color_inr: z.number().min(0).optional(),
  paper_sheet_cost_inr: z.number().min(0).optional(),
});

export const CostEstimateSchema = z.object({
  page_count: z.number().int().min(1),
  copies: z.number().int().min(1).max(99).default(1),
  color_mode: z.enum(['monochrome', 'color']).default('monochrome'),
  duplex_mode: z.enum(['simplex', 'manual_duplex']).default('simplex'),
});

export const RecoverJobConfirmationSchema = z.object({
  confirmed_completed_page: z.number().int().min(0),
  resume_from_page: z.number().int().min(1),
  resume_from_copy: z.number().int().min(1).default(1),
});

export const AutomationSettingsSchema = z.object({
  auto_start_on_printer_available: z.boolean().default(true),
  battery_threshold_percent: z.number().int().min(5).max(50).default(15),
  pause_on_low_battery: z.boolean().default(true),
  auto_convert_images: z.boolean().default(true),
  auto_compress_threshold_mb: z.number().min(1).max(50).default(10),
  max_network_retries: z.number().int().min(0).max(10).default(3),
});

