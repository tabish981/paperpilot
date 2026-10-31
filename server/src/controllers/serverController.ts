import { Request, Response } from 'express';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../database/connection';
import { STORAGE_PATHS } from '../utils/storage';
import { ServerHealthResponse, PrinterStatus } from '@paperpilot/shared';

const SERVER_START_TIME = Date.now();

export class ServerController {
  public static async getHealth(req: Request, res: Response): Promise<void> {
    try {
      const memoryUsage = process.memoryUsage();

      // Count documents
      const docsCount = await db.get<{ count: number }>('SELECT count(*) as count FROM documents');

      // Count queue jobs
      const pendingJobs = await db.get<{ count: number }>(
        'SELECT count(*) as count FROM print_jobs WHERE status IN ("PENDING", "WAITING_FOR_PRINTER", "VALIDATING")'
      );
      const activeJobs = await db.get<{ count: number }>(
        'SELECT count(*) as count FROM print_jobs WHERE status = "PRINTING"'
      );

      // Check default printer status
      const defaultPrinter = await db.get<{ id: string; status: PrinterStatus }>(
        'SELECT id, status FROM printers WHERE is_default = 1 LIMIT 1'
      );

      // Compute storage size
      let totalStorageBytes = 0;
      if (fs.existsSync(STORAGE_PATHS.DOCUMENTS)) {
        const files = fs.readdirSync(STORAGE_PATHS.DOCUMENTS);
        for (const file of files) {
          const stat = fs.statSync(path.join(STORAGE_PATHS.DOCUMENTS, file));
          totalStorageBytes += stat.size;
        }
      }

      const health: ServerHealthResponse = {
        status: 'healthy',
        uptime_seconds: Math.floor((Date.now() - SERVER_START_TIME) / 1000),
        server_timestamp: new Date().toISOString(),
        memory: {
          rss_mb: Math.round(memoryUsage.rss / 1024 / 1024),
          heap_total_mb: Math.round(memoryUsage.heapTotal / 1024 / 1024),
          heap_used_mb: Math.round(memoryUsage.heapUsed / 1024 / 1024),
          system_free_mb: Math.round(os.freemem() / 1024 / 1024),
          system_total_mb: Math.round(os.totalmem() / 1024 / 1024),
        },
        storage: {
          documents_count: docsCount?.count || 0,
          storage_size_mb: Math.round(totalStorageBytes / 1024 / 1024),
        },
        database: {
          status: 'connected',
          wal_mode: true,
          pending_jobs_count: pendingJobs?.count || 0,
          active_jobs_count: activeJobs?.count || 0,
        },
        printer: {
          active_id: defaultPrinter?.id,
          status: defaultPrinter?.status || 'UNKNOWN',
        },
      };

      res.status(200).json(health);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: 'Failed to inspect server health', details: msg });
    }
  }

  public static async getStatus(req: Request, res: Response): Promise<void> {
    try {
      const cpuInfo = os.cpus();
      const networkInterfaces = os.networkInterfaces();

      res.status(200).json({
        platform: os.platform(),
        arch: os.arch(),
        hostname: os.hostname(),
        node_version: process.version,
        cpus: cpuInfo.length,
        network_interfaces: Object.keys(networkInterfaces),
        uptime_system_seconds: os.uptime(),
        uptime_process_seconds: Math.floor((Date.now() - SERVER_START_TIME) / 1000),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: 'Failed to get server status', details: msg });
    }
  }

  public static async getStorage(req: Request, res: Response): Promise<void> {
    try {
      const categories: Record<string, { count: number; bytes: number }> = {
        documents: { count: 0, bytes: 0 },
        processed: { count: 0, bytes: 0 },
        backups: { count: 0, bytes: 0 },
      };

      for (const [key, dir] of Object.entries({
        documents: STORAGE_PATHS.DOCUMENTS,
        processed: STORAGE_PATHS.PROCESSED,
        backups: STORAGE_PATHS.BACKUPS,
      })) {
        if (fs.existsSync(dir)) {
          const files = fs.readdirSync(dir);
          categories[key].count = files.length;
          for (const f of files) {
            categories[key].bytes += fs.statSync(path.join(dir, f)).size;
          }
        }
      }

      res.status(200).json({
        storage: categories,
        base_path: STORAGE_PATHS.BASE,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: 'Failed to get storage metrics', details: msg });
    }
  }

  public static async getLogs(req: Request, res: Response): Promise<void> {
    try {
      const limit = Math.min(100, parseInt((req.query.limit as string) || '50', 10));
      const logs = await db.all(
        'SELECT * FROM server_logs ORDER BY created_at DESC LIMIT ?',
        [limit]
      );
      res.status(200).json({ logs });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: 'Failed to get logs', details: msg });
    }
  }

  public static async createBackup(req: Request, res: Response): Promise<void> {
    try {
      const backupId = uuidv4();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFileName = `paperpilot_backup_${timestamp}.sqlite`;
      const backupPath = path.join(STORAGE_PATHS.BACKUPS, backupFileName);

      const dbSourcePath = path.join(STORAGE_PATHS.BASE, 'paperpilot.sqlite');
      if (fs.existsSync(dbSourcePath)) {
        fs.copyFileSync(dbSourcePath, backupPath);
      }

      await db.run(
        'INSERT INTO server_logs (id, level, source, message) VALUES (?, ?, ?, ?)',
        [uuidv4(), 'INFO', 'BACKUP', `Database snapshot saved to ${backupFileName}`]
      );

      res.status(201).json({
        message: 'Backup created successfully',
        backup_file: backupFileName,
        backup_id: backupId,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: 'Backup creation failed', details: msg });
    }
  }
}
