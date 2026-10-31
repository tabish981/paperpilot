import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../database/connection';
import { socketService } from '../services/socketService';
import { queueWorker } from '../workers/queueWorker';
import {
  CreatePrintJobSchema,
  UpdatePrintJobSchema,
  RecoverJobConfirmationSchema,
  ReorderQueueSchema,
  PrintJobRecord,
  PrintJobCheckpointRecord,
  PrintJobEventRecord,
} from '@paperpilot/shared';

export class QueueController {
  public static async enqueueJob(req: Request, res: Response): Promise<void> {
    try {
      const parsed = CreatePrintJobSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.format() });
        return;
      }

      const {
        document_id,
        printer_id,
        copies,
        page_range,
        paper_size,
        orientation,
        color_mode,
        duplex_mode,
        priority,
      } = parsed.data;

      // Verify document exists
      const doc = await db.get('SELECT id FROM documents WHERE id = ?', [document_id]);
      if (!doc) {
        res.status(404).json({ error: 'Document not found' });
        return;
      }

      // Check max queue position
      const maxPos = await db.get<{ max_pos: number | null }>(
        'SELECT MAX(queue_position) as max_pos FROM print_jobs WHERE status IN ("PENDING", "WAITING_FOR_PRINTER", "VALIDATING", "PRINTING")'
      );
      const queuePosition = (maxPos?.max_pos ?? 0) + 1;

      const jobId = uuidv4();

      await db.run(
        `INSERT INTO print_jobs (
          id, document_id, printer_id, copies, page_range, paper_size, orientation,
          color_mode, duplex_mode, priority, queue_position, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
        [
          jobId,
          document_id,
          printer_id || null,
          copies,
          page_range,
          paper_size,
          orientation,
          color_mode,
          duplex_mode,
          priority,
          queuePosition,
        ]
      );

      // Log initial event
      await db.run(
        'INSERT INTO print_job_events (id, job_id, event_type, message) VALUES (?, ?, ?, ?)',
        [uuidv4(), jobId, 'JOB_CREATED', `Job enqueued with ${copies} copies, priority ${priority}`]
      );

      const job = await QueueController.getJobWithDetails(jobId);
      const fullQueue = await QueueController.fetchActiveQueue();
      socketService.emitQueueUpdated(fullQueue);

      // Wake up the worker
      queueWorker.trigger();

      res.status(201).json({ message: 'Job enqueued successfully', job });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: 'Failed to enqueue job', details: msg });
    }
  }

  public static async listQueue(req: Request, res: Response): Promise<void> {
    try {
      const statusFilter = typeof req.query.status === 'string' ? req.query.status : null;

      let sql = `
        SELECT 
          j.*,
          d.original_name as doc_name,
          d.file_size as doc_size,
          d.page_count as doc_pages,
          d.mime_type as doc_mime,
          p.name as printer_name,
          p.model as printer_model,
          p.status as printer_status
        FROM print_jobs j
        JOIN documents d ON j.document_id = d.id
        LEFT JOIN printers p ON j.printer_id = p.id
      `;

      const params: unknown[] = [];
      if (statusFilter) {
        sql += ' WHERE j.status = ?';
        params.push(statusFilter);
      }

      sql += `
        ORDER BY 
          CASE j.status 
            WHEN 'PRINTING' THEN 1 
            WHEN 'SUBMITTED' THEN 2
            WHEN 'VALIDATING' THEN 3
            WHEN 'PENDING' THEN 4
            WHEN 'WAITING_FOR_PRINTER' THEN 5
            WHEN 'NEEDS_CONFIRMATION' THEN 6
            WHEN 'PAUSED' THEN 7
            WHEN 'INTERRUPTED' THEN 8
            WHEN 'COMPLETED' THEN 9
            WHEN 'FAILED' THEN 10
            WHEN 'CANCELLED' THEN 11
            ELSE 12 
          END,
          j.priority ASC,
          j.queue_position ASC,
          j.created_at ASC
      `;

      const rows = await db.all<Record<string, unknown>>(sql, params);
      const jobs = rows.map((r) => QueueController.formatJobRecord(r));

      // Check global pause state
      const queuePausedRow = await db.get<{ value: string }>(
        "SELECT value FROM application_settings WHERE key = 'queue_paused'"
      );
      const isQueuePaused = queuePausedRow?.value === 'true';

      res.status(200).json({
        queue: jobs,
        count: jobs.length,
        isQueuePaused,
        activeJobId: queueWorker.getActiveJobId(),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: 'Failed to list queue', details: msg });
    }
  }

  public static async getJob(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const job = await QueueController.getJobWithDetails(id);

      if (!job) {
        res.status(404).json({ error: 'Print job not found' });
        return;
      }

      const checkpoints = await db.all<PrintJobCheckpointRecord>(
        'SELECT * FROM print_job_checkpoints WHERE job_id = ? ORDER BY copy_index ASC, completed_page ASC',
        [id]
      );

      const events = await db.all<PrintJobEventRecord>(
        'SELECT * FROM print_job_events WHERE job_id = ? ORDER BY created_at DESC',
        [id]
      );

      res.status(200).json({ job, checkpoints, events });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: 'Failed to get job', details: msg });
    }
  }

  public static async updateJob(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const parsed = UpdatePrintJobSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.format() });
        return;
      }

      const existing = await db.get<PrintJobRecord>('SELECT * FROM print_jobs WHERE id = ?', [id]);
      if (!existing) {
        res.status(404).json({ error: 'Print job not found' });
        return;
      }

      if (['PRINTING', 'SUBMITTED'].includes(existing.status)) {
        res.status(400).json({ error: 'Cannot update a job that is actively printing or submitted' });
        return;
      }

      const fields: string[] = [];
      const params: unknown[] = [];

      for (const [key, val] of Object.entries(parsed.data)) {
        if (val !== undefined) {
          fields.push(`${key} = ?`);
          params.push(val);
        }
      }

      if (fields.length > 0) {
        fields.push("updated_at = datetime('now')");
        params.push(id);
        await db.run(`UPDATE print_jobs SET ${fields.join(', ')} WHERE id = ?`, params);
      }

      const updated = await QueueController.getJobWithDetails(id);
      const fullQueue = await QueueController.fetchActiveQueue();
      socketService.emitQueueUpdated(fullQueue);

      res.status(200).json({ message: 'Job updated successfully', job: updated });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: 'Failed to update job', details: msg });
    }
  }

  public static async deleteJob(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      await db.run('DELETE FROM print_jobs WHERE id = ?', [id]);

      const fullQueue = await QueueController.fetchActiveQueue();
      socketService.emitQueueUpdated(fullQueue);

      res.status(200).json({ message: 'Job removed from queue', id });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: 'Failed to delete job', details: msg });
    }
  }

  public static async pauseJob(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      await db.run("UPDATE print_jobs SET status = 'PAUSED', updated_at = datetime('now') WHERE id = ?", [
        id,
      ]);
      await db.run(
        'INSERT INTO print_job_events (id, job_id, event_type, message) VALUES (?, ?, ?, ?)',
        [uuidv4(), id, 'JOB_PAUSED', 'Job paused by user']
      );

      const job = await QueueController.getJobWithDetails(id);
      const fullQueue = await QueueController.fetchActiveQueue();
      socketService.emitQueueUpdated(fullQueue);

      res.status(200).json({ message: 'Job paused', job });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: 'Failed to pause job', details: msg });
    }
  }

  public static async resumeJob(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      await db.run(
        "UPDATE print_jobs SET status = 'PENDING', updated_at = datetime('now') WHERE id = ?",
        [id]
      );
      await db.run(
        'INSERT INTO print_job_events (id, job_id, event_type, message) VALUES (?, ?, ?, ?)',
        [uuidv4(), id, 'JOB_RESUMED', 'Job resumed by user']
      );

      const job = await QueueController.getJobWithDetails(id);
      const fullQueue = await QueueController.fetchActiveQueue();
      socketService.emitQueueUpdated(fullQueue);

      // Trigger worker
      queueWorker.trigger();

      res.status(200).json({ message: 'Job resumed', job });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: 'Failed to resume job', details: msg });
    }
  }

  public static async cancelJob(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      await db.run(
        "UPDATE print_jobs SET status = 'CANCELLED', updated_at = datetime('now') WHERE id = ?",
        [id]
      );
      await db.run(
        'INSERT INTO print_job_events (id, job_id, event_type, message) VALUES (?, ?, ?, ?)',
        [uuidv4(), id, 'JOB_CANCELLED', 'Job cancelled by user']
      );

      const job = await QueueController.getJobWithDetails(id);
      const fullQueue = await QueueController.fetchActiveQueue();
      socketService.emitQueueUpdated(fullQueue);

      res.status(200).json({ message: 'Job cancelled', job });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: 'Failed to cancel job', details: msg });
    }
  }

  public static async retryJob(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      await db.run(
        `UPDATE print_jobs SET 
          status = 'PENDING',
          error_message = NULL,
          updated_at = datetime('now')
        WHERE id = ? AND status IN ('FAILED', 'CANCELLED', 'INTERRUPTED')`,
        [id]
      );

      await db.run(
        'INSERT INTO print_job_events (id, job_id, event_type, message) VALUES (?, ?, ?, ?)',
        [uuidv4(), id, 'JOB_RETRY', 'Job queued for retry']
      );

      const job = await QueueController.getJobWithDetails(id);
      const fullQueue = await QueueController.fetchActiveQueue();
      socketService.emitQueueUpdated(fullQueue);

      queueWorker.trigger();

      res.status(200).json({ message: 'Job queued for retry', job });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: 'Failed to retry job', details: msg });
    }
  }

  public static async reorderQueue(req: Request, res: Response): Promise<void> {
    try {
      const parsed = ReorderQueueSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid reorder array', details: parsed.error.format() });
        return;
      }

      const { jobIdsInOrder } = parsed.data;

      // Update positions sequentially
      for (let i = 0; i < jobIdsInOrder.length; i++) {
        await db.run(
          "UPDATE print_jobs SET queue_position = ?, updated_at = datetime('now') WHERE id = ?",
          [i + 1, jobIdsInOrder[i]]
        );
      }

      const fullQueue = await QueueController.fetchActiveQueue();
      socketService.emitQueueUpdated(fullQueue);

      // Trigger worker to re-evaluate top job
      queueWorker.trigger();

      res.status(200).json({ message: 'Queue reordered successfully', queue: fullQueue });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: 'Failed to reorder queue', details: msg });
    }
  }

  public static async pauseAll(req: Request, res: Response): Promise<void> {
    try {
      await db.run(
        'INSERT OR REPLACE INTO application_settings (key, value, updated_at) VALUES ("queue_paused", "true", datetime("now"))'
      );

      const fullQueue = await QueueController.fetchActiveQueue();
      socketService.emitQueueUpdated(fullQueue);

      res.status(200).json({ message: 'Print queue globally paused', isQueuePaused: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: 'Failed to pause queue', details: msg });
    }
  }

  public static async resumeAll(req: Request, res: Response): Promise<void> {
    try {
      await db.run(
        'INSERT OR REPLACE INTO application_settings (key, value, updated_at) VALUES ("queue_paused", "false", datetime("now"))'
      );

      const fullQueue = await QueueController.fetchActiveQueue();
      socketService.emitQueueUpdated(fullQueue);

      queueWorker.trigger();

      res.status(200).json({ message: 'Print queue globally resumed', isQueuePaused: false });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: 'Failed to resume queue', details: msg });
    }
  }

  public static async clearCompleted(req: Request, res: Response): Promise<void> {
    try {
      const result = await db.run(
        "DELETE FROM print_jobs WHERE status IN ('COMPLETED', 'CANCELLED')"
      );

      const fullQueue = await QueueController.fetchActiveQueue();
      socketService.emitQueueUpdated(fullQueue);

      res.status(200).json({
        message: `Cleared ${result.changes} finished job(s) from queue`,
        clearedCount: result.changes,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: 'Failed to clear completed jobs', details: msg });
    }
  }

  public static async recoverJob(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const parsed = RecoverJobConfirmationSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid recovery parameters', details: parsed.error.format() });
        return;
      }

      const { confirmed_completed_page, resume_from_page, resume_from_copy } = parsed.data;

      const job = await db.get<PrintJobRecord>('SELECT * FROM print_jobs WHERE id = ?', [id]);
      if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }

      // Save user-confirmed checkpoint
      const checkpointId = uuidv4();
      await db.run(
        `INSERT INTO print_job_checkpoints (
          id, job_id, copy_index, completed_page, total_pages, is_verified_by_sensor, user_confirmed, notes
        ) VALUES (?, ?, ?, ?, ?, 0, 1, ?)`,
        [
          checkpointId,
          id,
          resume_from_copy,
          confirmed_completed_page,
          job.last_confirmed_page,
          `User confirmed page ${confirmed_completed_page}. Resuming from page ${resume_from_page}.`,
        ]
      );

      // Update print job page_range and status
      const updatedRange = `${resume_from_page}-end`;
      await db.run(
        `UPDATE print_jobs SET 
          status = 'PENDING',
          page_range = ?,
          last_confirmed_page = ?,
          last_confirmed_copy = ?,
          error_message = NULL,
          updated_at = datetime('now')
        WHERE id = ?`,
        [updatedRange, confirmed_completed_page, resume_from_copy, id]
      );

      await db.run(
        'INSERT INTO print_job_events (id, job_id, event_type, message) VALUES (?, ?, ?, ?)',
        [
          uuidv4(),
          id,
          'RECOVERY_COMMITTED',
          `Manual recovery: confirmed page ${confirmed_completed_page}, resuming from ${resume_from_page}`,
        ]
      );

      const updatedJob = await QueueController.getJobWithDetails(id);
      const fullQueue = await QueueController.fetchActiveQueue();
      socketService.emitQueueUpdated(fullQueue);

      queueWorker.trigger();

      res.status(200).json({
        message: 'Recovery checkpoint committed. Job ready to resume.',
        job: updatedJob,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: 'Failed to recover job', details: msg });
    }
  }

  public static async confirmDuplexStep(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const job = await db.get<PrintJobRecord>('SELECT * FROM print_jobs WHERE id = ?', [id]);
      if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }

      if (job.status !== 'NEEDS_CONFIRMATION') {
        res.status(400).json({
          error: `Job is not awaiting duplex confirmation (current status: ${job.status})`,
        });
        return;
      }

      await db.run(
        `UPDATE print_jobs SET 
          status = 'PENDING',
          error_message = NULL,
          updated_at = datetime('now')
        WHERE id = ?`,
        [id]
      );

      await db.run(
        'INSERT INTO print_job_events (id, job_id, event_type, message) VALUES (?, ?, ?, ?)',
        [
          uuidv4(),
          id,
          'MANUAL_DUPLEX_CONFIRMED',
          'User reloaded paper into tray and confirmed manual duplex second pass.',
        ]
      );

      const updatedJob = await QueueController.getJobWithDetails(id);
      const fullQueue = await QueueController.fetchActiveQueue();
      socketService.emitQueueUpdated(fullQueue);

      queueWorker.trigger();

      res.status(200).json({
        message: 'Duplex second pass confirmed. Printing even pages.',
        job: updatedJob,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: 'Failed to confirm duplex step', details: msg });
    }
  }

  // --- Helpers ---

  public static async fetchActiveQueue(): Promise<PrintJobRecord[]> {
    const rows = await db.all<Record<string, unknown>>(`
      SELECT 
        j.*,
        d.original_name as doc_name,
        d.file_size as doc_size,
        d.page_count as doc_pages,
        d.mime_type as doc_mime,
        p.name as printer_name,
        p.model as printer_model,
        p.status as printer_status
      FROM print_jobs j
      JOIN documents d ON j.document_id = d.id
      LEFT JOIN printers p ON j.printer_id = p.id
      ORDER BY 
        CASE j.status 
          WHEN 'PRINTING' THEN 1 
          WHEN 'SUBMITTED' THEN 2
          WHEN 'VALIDATING' THEN 3
          WHEN 'PENDING' THEN 4
          WHEN 'WAITING_FOR_PRINTER' THEN 5
          WHEN 'NEEDS_CONFIRMATION' THEN 6
          WHEN 'PAUSED' THEN 7
          WHEN 'INTERRUPTED' THEN 8
          WHEN 'COMPLETED' THEN 9
          WHEN 'FAILED' THEN 10
          WHEN 'CANCELLED' THEN 11
          ELSE 12 
        END,
        j.priority ASC,
        j.queue_position ASC,
        j.created_at ASC
    `);

    return rows.map((r) => QueueController.formatJobRecord(r));
  }

  public static async getJobWithDetails(id: string): Promise<PrintJobRecord | undefined> {
    const r = await db.get<Record<string, unknown>>(
      `SELECT 
        j.*,
        d.original_name as doc_name,
        d.file_size as doc_size,
        d.page_count as doc_pages,
        d.mime_type as doc_mime,
        p.name as printer_name,
        p.model as printer_model,
        p.status as printer_status
      FROM print_jobs j
      JOIN documents d ON j.document_id = d.id
      LEFT JOIN printers p ON j.printer_id = p.id
      WHERE j.id = ?`,
      [id]
    );

    return r ? QueueController.formatJobRecord(r) : undefined;
  }

  private static formatJobRecord(r: Record<string, unknown>): PrintJobRecord {
    return {
      id: r.id as string,
      document_id: r.document_id as string,
      printer_id: (r.printer_id as string) || null,
      copies: Number(r.copies),
      page_range: r.page_range as string,
      paper_size: r.paper_size as PrintJobRecord['paper_size'],
      orientation: r.orientation as PrintJobRecord['orientation'],
      color_mode: r.color_mode as PrintJobRecord['color_mode'],
      duplex_mode: r.duplex_mode as PrintJobRecord['duplex_mode'],
      priority: Number(r.priority),
      queue_position: Number(r.queue_position),
      status: r.status as PrintJobRecord['status'],
      error_message: r.error_message as string | undefined,
      last_confirmed_copy: Number(r.last_confirmed_copy || 0),
      last_confirmed_page: Number(r.last_confirmed_page || 0),
      created_at: r.created_at as string,
      updated_at: r.updated_at as string,
      document: r.doc_name
        ? {
            id: r.document_id as string,
            original_name: r.doc_name as string,
            stored_filename: '',
            file_path: '',
            file_size: Number(r.doc_size),
            mime_type: r.doc_mime as string,
            sha256_hash: '',
            page_count: Number(r.doc_pages),
            is_processed: false,
            created_at: '',
            updated_at: '',
          }
        : undefined,
    };
  }
}
