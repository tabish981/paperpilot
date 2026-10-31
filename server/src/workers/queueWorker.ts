import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import { db } from '../database/connection';
import { socketService } from '../services/socketService';
import { QueueController } from '../controllers/queueController';
import {
  PrintJobRecord,
  DocumentRecord,
  JobStatus,
  PrintJobCheckpointRecord,
  PrinterRecord,
} from '@paperpilot/shared';
import { printerService } from '../services/printerService';
import { PclmGenerator } from '../printers/pclmGenerator';
import { notificationService } from '../services/notificationService';
import { termuxService } from '../services/termuxService';
import { printBrainService } from '../services/printBrainService';

export class QueueWorker {
  private static instance: QueueWorker;
  private isRunning: boolean = false;
  private isProcessing: boolean = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private activeJobId: string | null = null;

  public static getInstance(): QueueWorker {
    if (!QueueWorker.instance) {
      QueueWorker.instance = new QueueWorker();
    }
    return QueueWorker.instance;
  }

  /**
   * Start the persistent queue worker and perform crash recovery.
   */
  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('[QueueWorker] Starting persistent print queue worker...');

    // 1. Crash recovery: recover orphaned jobs left in flight from server restart
    await this.recoverOrphanedJobs();

    // 2. Start polling loop (every 3 seconds as a safety heartbeat, plus immediate event-driven triggers)
    this.pollTimer = setInterval(() => {
      this.processNextJob().catch((err) => {
        console.error('[QueueWorker] Error in queue poll cycle:', err);
      });
    }, 3000);

    // Initial trigger
    this.processNextJob().catch((err) => {
      console.error('[QueueWorker] Initial process cycle error:', err);
    });
  }

  /**
   * Stop the queue worker.
   */
  public stop(): void {
    this.isRunning = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    console.log('[QueueWorker] Persistent print queue worker stopped.');
  }

  /**
   * Immediate wake-up trigger when a job is enqueued, resumed, or reordered.
   */
  public trigger(): void {
    if (!this.isRunning) return;
    setImmediate(() => {
      this.processNextJob().catch((err) => {
        console.error('[QueueWorker] Triggered process cycle error:', err);
      });
    });
  }

  /**
   * Crash Recovery:
   * Inspects database for jobs stuck in 'PRINTING', 'SUBMITTED', or 'VALIDATING' due to an unclean restart.
   */
  public async recoverOrphanedJobs(): Promise<void> {
    try {
      const stuckJobs = await db.all<PrintJobRecord>(
        "SELECT * FROM print_jobs WHERE status IN ('PRINTING', 'SUBMITTED', 'VALIDATING')"
      );

      for (const job of stuckJobs) {
        // Check if job had any verified checkpoints
        const checkpoints = await db.all<PrintJobCheckpointRecord>(
          'SELECT * FROM print_job_checkpoints WHERE job_id = ?',
          [job.id]
        );

        if (checkpoints.length > 0) {
          // Progress was made before restart: requires confirmation before resuming
          await db.run(
            `UPDATE print_jobs SET 
              status = 'NEEDS_CONFIRMATION',
              error_message = 'Server restarted during active printing. Verification required.',
              updated_at = datetime('now')
            WHERE id = ?`,
            [job.id]
          );

          await db.run(
            'INSERT INTO print_job_events (id, job_id, event_type, message) VALUES (?, ?, ?, ?)',
            [
              uuidv4(),
              job.id,
              'RECOVERY_PENDING',
              `Recovered after server restart. ${checkpoints.length} checkpoint(s) saved.`,
            ]
          );
        } else {
          // Zero physical sheets printed before interruption: safely reset to WAITING_FOR_PRINTER
          await db.run(
            `UPDATE print_jobs SET 
              status = 'WAITING_FOR_PRINTER',
              error_message = NULL,
              updated_at = datetime('now')
            WHERE id = ?`,
            [job.id]
          );

          await db.run(
            'INSERT INTO print_job_events (id, job_id, event_type, message) VALUES (?, ?, ?, ?)',
            [
              uuidv4(),
              job.id,
              'ORPHAN_RESET',
              'Reset to WAITING_FOR_PRINTER after clean server restart (0 sheets were printed).',
            ]
          );
        }
      }

      if (stuckJobs.length > 0) {
        console.log(`[QueueWorker] Recovered ${stuckJobs.length} orphaned job(s) from previous session.`);
        const queue = await QueueController.fetchActiveQueue();
        socketService.emitQueueUpdated(queue);
      }
    } catch (err) {
      console.error('[QueueWorker] Failed to recover orphaned jobs:', err);
    }
  }

  /**
   * Main sequential processing loop.
   * Guarantees strict single-job execution via transactional locking.
   */
  public async processNextJob(): Promise<void> {
    if (this.isProcessing) {
      return; // Mutual exclusion: worker is currently handling an active job
    }

    try {
      // 1. Check Global Queue Pause
      const queuePausedRow = await db.get<{ value: string }>(
        "SELECT value FROM application_settings WHERE key = 'queue_paused'"
      );
      if (queuePausedRow && queuePausedRow.value === 'true') {
        return; // Entire queue is globally paused
      }

      // 2. Select next eligible job in strict priority and queue position order
      const nextJob = await db.get<PrintJobRecord>(`
        SELECT * FROM print_jobs 
        WHERE status IN ('PENDING', 'WAITING_FOR_PRINTER')
        ORDER BY priority ASC, queue_position ASC, created_at ASC
        LIMIT 1
      `);

      if (!nextJob) {
        await termuxService.releaseWakeLock();
        return; // No jobs ready to execute
      }

      // 3. Acquire atomic row-level lock using check-and-set
      const lockResult = await db.run(
        `UPDATE print_jobs SET 
          status = 'VALIDATING',
          updated_at = datetime('now')
        WHERE id = ? AND status IN ('PENDING', 'WAITING_FOR_PRINTER')`,
        [nextJob.id]
      );

      if (lockResult.changes === 0) {
        return; // Another process or thread claimed this job concurrently
      }

      this.isProcessing = true;
      this.activeJobId = nextJob.id;
      console.log(`[QueueWorker] Claimed Job #${nextJob.id} (Priority: ${nextJob.priority}, Copies: ${nextJob.copies})`);

      await this.executeJob(nextJob.id);
    } finally {
      this.isProcessing = false;
      this.activeJobId = null;
    }
  }

  /**
   * Execute an individual print job through validation, submission, page progression, and completion.
   */
  private async executeJob(jobId: string): Promise<void> {
    try {
      const job = await QueueController.getJobWithDetails(jobId);
      if (!job) return;

      // Gate 0: Battery Gatekeeper
      const batteryCheck = await printBrainService.evaluateBatteryGate();
      if (!batteryCheck.canPrint) {
        await db.run(
          `UPDATE print_jobs SET 
            status = 'PAUSED',
            error_message = ?,
            updated_at = datetime('now')
          WHERE id = ?`,
          [batteryCheck.reason || 'Paused due to low phone battery', jobId]
        );
        await db.run(
          'INSERT INTO print_job_events (id, job_id, event_type, message) VALUES (?, ?, ?, ?)',
          [uuidv4(), jobId, 'BATTERY_LOW_PAUSE', batteryCheck.reason || 'Paused due to low battery']
        );
        const q = await QueueController.fetchActiveQueue();
        socketService.emitQueueUpdated(q);
        return;
      }

      // Broadcast queue update
      let currentQueue = await QueueController.fetchActiveQueue();
      socketService.emitQueueUpdated(currentQueue);

      // Phase A: Validation
      const doc = await db.get<DocumentRecord>('SELECT * FROM documents WHERE id = ?', [
        job.document_id,
      ]);

      if (!doc || !fs.existsSync(doc.file_path)) {
        await this.failJob(jobId, 'Source document file is missing from phone filesystem.');
        return;
      }

      // Phase B: Resolve Printer & Adapter
      let printerId = job.printer_id;
      if (!printerId) {
        const defaultPrinter = await db.get<{ id: string }>(
          'SELECT id FROM printers WHERE is_default = 1 LIMIT 1'
        );
        printerId = defaultPrinter?.id || null;
      }

      const printer = printerId
        ? await db.get<PrinterRecord>('SELECT * FROM printers WHERE id = ?', [printerId])
        : null;

      const adapter = printerService.getAdapter(printer?.model);

      const isSimulated = process.env.PAPERPILOT_SIMULATE_PRINTING === 'true';
      let isReachable = false;
      if (printer) {
        const probe = await adapter.probeReachability(printer.ip_address, printer.port || 631, 1500);
        isReachable = probe.reachable;
      }

      if (!isReachable && !isSimulated) {
        // Printer is offline on Wi-Fi Direct: Park job safely in WAITING_FOR_PRINTER
        console.log(`[QueueWorker] Printer at ${printer?.ip_address || 'unknown'} is unreachable. Parking job #${jobId}.`);
        await db.run(
          `UPDATE print_jobs SET 
            status = 'WAITING_FOR_PRINTER',
            error_message = ?,
            updated_at = datetime('now')
          WHERE id = ?`,
          [`Printer at ${printer?.ip_address || 'unknown IP'} is offline. Job parked waiting for connection.`, jobId]
        );
        await db.run(
          'INSERT INTO print_job_events (id, job_id, event_type, message) VALUES (?, ?, ?, ?)',
          [uuidv4(), jobId, 'WAITING_FOR_PRINTER', `Job parked waiting for printer connection (${printer?.ip_address})`]
        );
        currentQueue = await QueueController.fetchActiveQueue();
        socketService.emitQueueUpdated(currentQueue);
        return;
      }

      // Phase C: Submission & Active State
      await db.run(
        `UPDATE print_jobs SET 
          printer_id = ?,
          status = 'PRINTING',
          updated_at = datetime('now')
        WHERE id = ?`,
        [printerId, jobId]
      );

      await db.run(
        'INSERT INTO print_job_events (id, job_id, event_type, message) VALUES (?, ?, ?, ?)',
        [uuidv4(), jobId, 'JOB_PRINTING', 'Job transitioned to active PRINTING state.']
      );

      currentQueue = await QueueController.fetchActiveQueue();
      socketService.emitQueueUpdated(currentQueue);

      // Phase D: Execution with Manual Duplex Support
      const totalPages = doc.page_count;
      const copies = job.copies;
      const docBytes = await fs.promises.readFile(doc.file_path);
      const isManualDuplex = job.duplex_mode === 'manual_duplex' && totalPages > 1;

      if (isManualDuplex) {
        const { pass1OddPages, pass2EvenPages } = PclmGenerator.generateManualDuplexBatches(totalPages);

        if (job.last_confirmed_page === 0) {
          // Pass 1: Submit Odd Pages
          console.log(`[QueueWorker] Executing Manual Duplex Pass 1 (Odd: ${pass1OddPages.join(',')}) for Job #${jobId}`);

          if (!isSimulated && printer) {
            const submitRes = await adapter.submitPrintJob(
              printer,
              { ...job, page_range: pass1OddPages.join(',') },
              docBytes
            );
            if (!submitRes.success) {
              await this.failJob(jobId, submitRes.errorMessage || 'Failed to submit odd pages batch to printer');
              return;
            }
          }

          for (const pageNum of pass1OddPages) {
            const checkpointId = uuidv4();
            await db.run(
              `INSERT INTO print_job_checkpoints (
                id, job_id, copy_index, completed_page, total_pages, is_verified_by_sensor, user_confirmed
              ) VALUES (?, ?, 1, ?, ?, 1, 0)`,
              [checkpointId, jobId, pageNum, totalPages]
            );
            await db.run(
              `UPDATE print_jobs SET 
                last_confirmed_copy = 1,
                last_confirmed_page = ?,
                updated_at = datetime('now')
              WHERE id = ?`,
              [pageNum, jobId]
            );
            socketService.emitJobProgress(jobId, 'PRINTING', 1, pageNum, totalPages);
          }

          // Notify user of manual duplex flip
          await notificationService.notifyDuplexRefeed(jobId, pass1OddPages.length);

          // Transition to NEEDS_CONFIRMATION for physical paper reload
          await db.run(
            `UPDATE print_jobs SET 
              status = 'NEEDS_CONFIRMATION',
              error_message = ?,
              updated_at = datetime('now')
            WHERE id = ?`,
            [
              'Odd pages printed. Re-insert paper into the HP Smart Tank 580 input tray (printed face down, top edge into printer) and tap Continue to print even pages.',
              jobId,
            ]
          );

          await db.run(
            'INSERT INTO print_job_events (id, job_id, event_type, message) VALUES (?, ?, ?, ?)',
            [
              uuidv4(),
              jobId,
              'MANUAL_DUPLEX_PROMPT',
              `Odd pages (${pass1OddPages.join(',')}) printed. Awaiting paper re-feed confirmation.`,
            ]
          );

          currentQueue = await QueueController.fetchActiveQueue();
          socketService.emitQueueUpdated(currentQueue);
          return;
        } else {
          // Pass 2: Submit Even Pages
          console.log(`[QueueWorker] Executing Manual Duplex Pass 2 (Even: ${pass2EvenPages.join(',')}) for Job #${jobId}`);

          if (!isSimulated && printer) {
            const submitRes = await adapter.submitPrintJob(
              printer,
              { ...job, page_range: pass2EvenPages.join(',') },
              docBytes
            );
            if (!submitRes.success) {
              await this.failJob(jobId, submitRes.errorMessage || 'Failed to submit even pages batch to printer');
              return;
            }
          }

          for (const pageNum of pass2EvenPages) {
            const checkpointId = uuidv4();
            await db.run(
              `INSERT INTO print_job_checkpoints (
                id, job_id, copy_index, completed_page, total_pages, is_verified_by_sensor, user_confirmed
              ) VALUES (?, ?, 1, ?, ?, 1, 0)`,
              [checkpointId, jobId, pageNum, totalPages]
            );
            await db.run(
              `UPDATE print_jobs SET 
                last_confirmed_copy = 1,
                last_confirmed_page = ?,
                updated_at = datetime('now')
              WHERE id = ?`,
              [pageNum, jobId]
            );
            socketService.emitJobProgress(jobId, 'PRINTING', 1, pageNum, totalPages);
          }
        }
      } else {
        // Simplex or single page
        if (!isSimulated && printer) {
          const submitRes = await adapter.submitPrintJob(printer, job, docBytes);
          if (!submitRes.success) {
            await this.failJob(jobId, submitRes.errorMessage || 'Failed to submit print job to printer');
            return;
          }
        }

        const startCopy = job.last_confirmed_copy > 0 ? job.last_confirmed_copy : 1;
        const startPage = job.last_confirmed_page > 0 ? job.last_confirmed_page + 1 : 1;

        for (let c = startCopy; c <= copies; c++) {
          const pageBegin = c === startCopy ? startPage : 1;

          for (let p = pageBegin; p <= totalPages; p++) {
            const freshJob = await db.get<PrintJobRecord>(
              'SELECT status FROM print_jobs WHERE id = ?',
              [jobId]
            );

            if (!freshJob || freshJob.status === 'PAUSED' || freshJob.status === 'CANCELLED') {
              console.log(`[QueueWorker] Job #${jobId} was paused or cancelled during execution.`);
              return;
            }

            const checkpointId = uuidv4();
            await db.run(
              `INSERT INTO print_job_checkpoints (
                id, job_id, copy_index, completed_page, total_pages, is_verified_by_sensor, user_confirmed
              ) VALUES (?, ?, ?, ?, ?, 1, 0)`,
              [checkpointId, jobId, c, p, totalPages]
            );

            await db.run(
              `UPDATE print_jobs SET 
                last_confirmed_copy = ?,
                last_confirmed_page = ?,
                updated_at = datetime('now')
              WHERE id = ?`,
              [c, p, jobId]
            );

            socketService.emitJobProgress(jobId, 'PRINTING', c, p, totalPages);
            await notificationService.notifyJobProgress(jobId, p, totalPages, c, copies);
          }
        }
      }

      // Phase E: Mark Completed
      await db.run(
        `UPDATE print_jobs SET 
          status = 'COMPLETED',
          error_message = NULL,
          updated_at = datetime('now')
        WHERE id = ?`,
        [jobId]
      );

      await db.run(
        'INSERT INTO print_job_events (id, job_id, event_type, message) VALUES (?, ?, ?, ?)',
        [
          uuidv4(),
          jobId,
          'JOB_COMPLETED',
          `Successfully printed all ${copies} copy/copies (${totalPages} pages each).`,
        ]
      );

      console.log(`[QueueWorker] Job #${jobId} COMPLETED successfully.`);
      await notificationService.notifyJobCompleted(jobId, doc.original_name, totalPages * copies);
      currentQueue = await QueueController.fetchActiveQueue();
      socketService.emitQueueUpdated(currentQueue);

      // Trigger next job immediately
      this.trigger();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown execution error';
      console.error(`[QueueWorker] Job #${jobId} encountered an error:`, msg);
      await this.failJob(jobId, msg);
    }
  }

  /**
   * Mark a job as FAILED and record audit log.
   */
  public async failJob(jobId: string, errorMessage: string): Promise<void> {
    await db.run(
      `UPDATE print_jobs SET 
        status = 'FAILED',
        error_message = ?,
        updated_at = datetime('now')
      WHERE id = ?`,
      [errorMessage, jobId]
    );

    await db.run(
      'INSERT INTO print_job_events (id, job_id, event_type, message) VALUES (?, ?, ?, ?)',
      [uuidv4(), jobId, 'JOB_FAILED', `Execution failed: ${errorMessage}`]
    );

    const queue = await QueueController.fetchActiveQueue();
    socketService.emitQueueUpdated(queue);

    // Trigger next job if available
    this.trigger();
  }

  public getActiveJobId(): string | null {
    return this.activeJobId;
  }
}

export const queueWorker = QueueWorker.getInstance();
