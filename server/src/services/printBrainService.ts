import { db } from '../database/connection';
import { termuxService } from './termuxService';
import { notificationService } from './notificationService';
import { socketService } from './socketService';
import { queueWorker } from '../workers/queueWorker';
import { DocumentProcessor } from './documentProcessor';
import {
  AutomationSettings,
  AutomationSettingsSchema,
  DocumentRecord,
  PrintJobRecord,
  PrintJobCheckpointRecord,
} from '@paperpilot/shared';

const SETTINGS_KEY = 'automation_rules';

const DEFAULT_SETTINGS: AutomationSettings = {
  auto_start_on_printer_available: true,
  battery_threshold_percent: 15,
  pause_on_low_battery: true,
  auto_convert_images: true,
  auto_compress_threshold_mb: 10,
  max_network_retries: 3,
};

/**
 * PrintBrain Automation Engine & Smart Error Recovery Service
 *
 * Implements:
 * 1. Low-battery hardware gatekeeper (< 15% threshold)
 * 2. Automatic queue start when Wi-Fi Direct ladder reaches AVAILABLE
 * 3. Smart pipeline preprocessor (Image-to-PDF, auto-compression > 10MB)
 * 4. Interrupted print recovery (Physical paper sensor vs volatile spool separation)
 */
export class PrintBrainService {
  private static instance: PrintBrainService;

  private constructor() {}

  public static getInstance(): PrintBrainService {
    if (!PrintBrainService.instance) {
      PrintBrainService.instance = new PrintBrainService();
    }
    return PrintBrainService.instance;
  }

  /**
   * Retrieves active automation settings from SQLite.
   */
  public async getSettings(): Promise<AutomationSettings> {
    const row = await db.get<{ value: string }>(
      'SELECT value FROM application_settings WHERE key = ?',
      [SETTINGS_KEY]
    );

    if (!row) {
      // Seed default settings
      await db.run(
        'INSERT INTO application_settings (key, value, updated_at) VALUES (?, ?, datetime("now"))',
        [SETTINGS_KEY, JSON.stringify(DEFAULT_SETTINGS)]
      );
      return DEFAULT_SETTINGS;
    }

    try {
      const parsed = JSON.parse(row.value);
      return AutomationSettingsSchema.parse(parsed);
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  /**
   * Updates automation rules in SQLite.
   */
  public async updateSettings(updates: Partial<AutomationSettings>): Promise<AutomationSettings> {
    const current = await this.getSettings();
    const merged = AutomationSettingsSchema.parse({ ...current, ...updates });

    await db.run(
      `INSERT INTO application_settings (key, value, updated_at) 
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [SETTINGS_KEY, JSON.stringify(merged)]
    );

    return merged;
  }

  /**
   * Battery Gatekeeper: Evaluates phone battery state before dispatching print jobs.
   */
  public async evaluateBatteryGate(): Promise<{
    canPrint: boolean;
    batteryLevel: number;
    isPluggedIn: boolean;
    reason?: string;
  }> {
    const settings = await this.getSettings();
    const battery = await termuxService.getBatteryStatus();

    if (!settings.pause_on_low_battery) {
      return { canPrint: true, batteryLevel: battery.percentage, isPluggedIn: battery.isPluggedIn };
    }

    if (!battery.isPluggedIn && battery.percentage < settings.battery_threshold_percent) {
      const reason = `Printing paused: Phone battery is at ${battery.percentage}% (below ${settings.battery_threshold_percent}% safe threshold) and not connected to charger.`;
      console.warn(`[PrintBrain] ${reason}`);
      await notificationService.notifyHardwareAlert('LOW_INK', reason);
      return {
        canPrint: false,
        batteryLevel: battery.percentage,
        isPluggedIn: false,
        reason,
      };
    }

    return {
      canPrint: true,
      batteryLevel: battery.percentage,
      isPluggedIn: battery.isPluggedIn,
    };
  }

  /**
   * Auto-starts parked print jobs when the printer reaches AVAILABLE state.
   */
  public async onPrinterAvailable(printerId: string): Promise<number> {
    const settings = await this.getSettings();
    if (!settings.auto_start_on_printer_available) {
      return 0;
    }

    // Find all parked jobs
    const parkedJobs = await db.all<PrintJobRecord>(
      "SELECT id FROM print_jobs WHERE status = 'WAITING_FOR_PRINTER'"
    );

    if (parkedJobs.length === 0) return 0;

    await db.run(
      `UPDATE print_jobs SET 
        status = 'PENDING',
        error_message = NULL,
        updated_at = datetime('now')
      WHERE status = 'WAITING_FOR_PRINTER'`
    );

    console.log(`[PrintBrain] Automatically resumed ${parkedJobs.length} parked job(s) upon printer connectivity.`);

    // Wake up queue worker
    queueWorker.trigger();

    return parkedJobs.length;
  }

  /**
   * Smart Pipeline Preprocessor:
   * Auto-converts uploaded images to print-ready PDF and auto-compresses PDFs > 10MB.
   */
  public async preprocessUploadedDocument(docId: string): Promise<{
    wasProcessed: boolean;
    derivedDocId?: string;
    action?: string;
  }> {
    const doc = await db.get<DocumentRecord>('SELECT * FROM documents WHERE id = ?', [docId]);
    if (!doc) return { wasProcessed: false };

    const settings = await this.getSettings();

    // Rule 1: Auto-convert image to print-ready PDF
    if (settings.auto_convert_images && (doc.mime_type.startsWith('image/') || doc.original_name.match(/\.(png|jpe?g)$/i))) {
      console.log(`[PrintBrain] Auto-converting image "${doc.original_name}" to print-optimized A4 PDF...`);
      const targetName = `${doc.original_name.replace(/\.[^/.]+$/, '')}_print.pdf`;
      const converted = await DocumentProcessor.convertImagesToPdf([doc.id], targetName, 'A4');
      return {
        wasProcessed: true,
        derivedDocId: converted.id,
        action: 'IMAGE_TO_PDF',
      };
    }

    // Rule 2: Auto-compress files exceeding threshold (default 10 MB)
    const thresholdBytes = settings.auto_compress_threshold_mb * 1024 * 1024;
    if (doc.mime_type === 'application/pdf' && doc.file_size > thresholdBytes) {
      console.log(`[PrintBrain] Document size (${(doc.file_size / 1024 / 1024).toFixed(1)} MB) exceeds threshold (${settings.auto_compress_threshold_mb} MB). Compressing...`);
      const compResult = await DocumentProcessor.compressPdf(doc.id);
      return {
        wasProcessed: true,
        derivedDocId: compResult.document.id,
        action: 'COMPRESSED',
      };
    }

    return { wasProcessed: false };
  }

  /**
   * Intelligent Recovery: Calculates exact remaining sheets to resume
   * without re-printing physically ejected paper.
   */
  public async calculateRecoveryPlan(jobId: string): Promise<{
    lastCompletedPage: number;
    lastCompletedCopy: number;
    totalPages: number;
    totalCopies: number;
    remainingPages: number[];
    needsConfirmation: boolean;
  }> {
    const job = await db.get<PrintJobRecord>('SELECT * FROM print_jobs WHERE id = ?', [jobId]);
    if (!job) throw new Error(`Job not found: ${jobId}`);

    const doc = await db.get<DocumentRecord>('SELECT page_count FROM documents WHERE id = ?', [
      job.document_id,
    ]);
    const totalPages = doc?.page_count || 1;

    // Fetch verified sensor checkpoints
    const checkpoints = await db.all<PrintJobCheckpointRecord>(
      'SELECT * FROM print_job_checkpoints WHERE job_id = ? ORDER BY copy_index DESC, completed_page DESC LIMIT 1',
      [jobId]
    );

    const lastCheckpoint = checkpoints[0];
    const lastCompletedPage = lastCheckpoint ? lastCheckpoint.completed_page : job.last_confirmed_page || 0;
    const lastCompletedCopy = lastCheckpoint ? lastCheckpoint.copy_index : job.last_confirmed_copy || 1;

    const remainingPages: number[] = [];
    for (let p = lastCompletedPage + 1; p <= totalPages; p++) {
      remainingPages.push(p);
    }

    return {
      lastCompletedPage,
      lastCompletedCopy,
      totalPages,
      totalCopies: job.copies,
      remainingPages,
      needsConfirmation: lastCompletedPage > 0 && remainingPages.length > 0,
    };
  }
}

export const printBrainService = PrintBrainService.getInstance();
