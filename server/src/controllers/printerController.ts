import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../database/connection';
import { printerService } from '../services/printerService';
import {
  RegisterPrinterSchema,
  PrinterRecord,
  PrinterStatus,
} from '@paperpilot/shared';

export class PrinterController {
  public static async listPrinters(req: Request, res: Response): Promise<void> {
    try {
      const rows = await db.all<Record<string, unknown>>(
        'SELECT * FROM printers ORDER BY is_default DESC, name ASC'
      );
      const printers: PrinterRecord[] = rows.map((r) => ({
        id: r.id as string,
        name: r.name as string,
        model: r.model as string,
        ip_address: r.ip_address as string,
        port: Number(r.port),
        protocol: r.protocol as PrinterRecord['protocol'],
        is_default: Boolean(r.is_default),
        wifi_direct_ssid: (r.wifi_direct_ssid as string) || undefined,
        bssid: (r.bssid as string) || undefined,
        capabilities: JSON.parse((r.capabilities as string) || '{}'),
        status: r.status as PrinterStatus,
        last_seen: (r.last_seen as string) || undefined,
        created_at: r.created_at as string,
        updated_at: r.updated_at as string,
      }));

      const networkState = printerService.getCurrentNetwork();
      const currentStage = printerService.getCurrentStage();

      res.status(200).json({
        printers,
        count: printers.length,
        networkStage: currentStage,
        connectedSsid: networkState.ssid,
        gatewayIp: networkState.gatewayIp,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: 'Failed to list printers', details: msg });
    }
  }

  public static async registerPrinter(req: Request, res: Response): Promise<void> {
    try {
      const parsed = RegisterPrinterSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.format() });
        return;
      }

      const {
        name,
        model,
        ip_address,
        port,
        protocol,
        is_default,
        wifi_direct_ssid,
        bssid,
        capabilities,
      } = parsed.data;

      const id = uuidv4();

      if (is_default) {
        await db.run('UPDATE printers SET is_default = 0');
      }

      await db.run(
        `INSERT INTO printers (
          id, name, model, ip_address, port, protocol, is_default, wifi_direct_ssid, bssid, capabilities, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'UNKNOWN')`,
        [
          id,
          name,
          model,
          ip_address,
          port,
          protocol,
          is_default ? 1 : 0,
          wifi_direct_ssid || null,
          bssid || null,
          JSON.stringify(capabilities),
        ]
      );

      const created = await db.get<PrinterRecord>('SELECT * FROM printers WHERE id = ?', [id]);
      res.status(201).json({ message: 'Printer registered successfully', printer: created });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: 'Failed to register printer', details: msg });
    }
  }

  public static async deletePrinter(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      await db.run('DELETE FROM printers WHERE id = ?', [id]);
      res.status(200).json({ message: 'Printer removed', id });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: 'Failed to delete printer', details: msg });
    }
  }

  public static async discoverPrinters(req: Request, res: Response): Promise<void> {
    try {
      const gatewayIp = typeof req.body?.gatewayIp === 'string' ? req.body.gatewayIp.trim() : undefined;
      const discovered = await printerService.discoverPrinters(gatewayIp);

      res.status(200).json({
        message: `Discovery finished. Found ${discovered.length} active printer(s).`,
        discovered,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: 'Printer discovery failed', details: msg });
    }
  }

  public static async getPrinterStatus(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const readiness = await printerService.checkPrinterReadiness(id);
      const networkState = printerService.getCurrentNetwork();
      const currentStage = printerService.getCurrentStage();

      res.status(200).json({
        id,
        isReady: readiness.isReady,
        state: readiness.state,
        latencyMs: readiness.latencyMs,
        reasons: readiness.reasons,
        networkStage: currentStage,
        connectedSsid: networkState.ssid,
        gatewayIp: networkState.gatewayIp,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: 'Failed to inspect printer status', details: msg });
    }
  }

  public static async testPrinter(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const readiness = await printerService.checkPrinterReadiness(id);

      if (!readiness.isReady) {
        res.status(503).json({
          success: false,
          error: readiness.reasons.join('; ') || 'Printer is not ready.',
          readiness,
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: `Connection test successful! Printer is ready (Latency: ${readiness.latencyMs}ms).`,
        readiness,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: 'Test failed', details: msg });
    }
  }

  /**
   * Handle incoming network transition reported by Android native NetworkCallback.
   */
  public static async handleNetworkEvent(req: Request, res: Response): Promise<void> {
    try {
      const { ssid, bssid, gatewayIp, interfaceName, isConnected } = req.body;
      const result = await printerService.handleNetworkEvent({
        ssid,
        bssid,
        gatewayIp,
        interfaceName,
        isConnected: Boolean(isConnected),
      });

      res.status(200).json({
        message: 'Network event processed',
        ...result,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: 'Failed to process network event', details: msg });
    }
  }
}
