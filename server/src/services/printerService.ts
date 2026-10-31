import { db } from '../database/connection';
import { socketService } from './socketService';
import { PrinterAdapter, PrinterDiscoveryResult, PrinterReadinessResult } from '../printers/printerAdapter.interface';
import { HpSmartTank580Adapter } from '../printers/hpSmartTank580Adapter';
import { PrinterRecord, PrinterStatus } from '@paperpilot/shared';
import { notificationService } from './notificationService';
import { printBrainService } from './printBrainService';

export interface NetworkEventPayload {
  ssid?: string;
  bssid?: string;
  gatewayIp?: string;
  interfaceName?: string;
  isConnected: boolean;
}

export type NetworkStage =
  | 'DISCONNECTED'
  | 'NETWORK_DETECTED'
  | 'IP_REACHABLE'
  | 'PROTOCOL_AVAILABLE'
  | 'AVAILABLE';

export class PrinterService {
  private static instance: PrinterService;
  private adapters: Map<string, PrinterAdapter> = new Map();
  private currentNetworkStage: NetworkStage = 'DISCONNECTED';
  private currentConnectedSsid?: string;
  private currentGatewayIp?: string;

  private constructor() {
    const hpAdapter = new HpSmartTank580Adapter();
    this.adapters.set(hpAdapter.modelName, hpAdapter);
    this.adapters.set('default', hpAdapter);
  }

  public static getInstance(): PrinterService {
    if (!PrinterService.instance) {
      PrinterService.instance = new PrinterService();
    }
    return PrinterService.instance;
  }

  public getAdapter(model?: string): PrinterAdapter {
    if (model && this.adapters.has(model)) {
      return this.adapters.get(model)!;
    }
    return this.adapters.get('default')!;
  }

  /**
   * Handle incoming network transition reported by Android native NetworkCallback.
   */
  public async handleNetworkEvent(event: NetworkEventPayload): Promise<{
    stage: NetworkStage;
    printerStatus: PrinterStatus;
    details: string;
  }> {
    if (!event.isConnected) {
      this.currentNetworkStage = 'DISCONNECTED';
      this.currentConnectedSsid = undefined;
      this.currentGatewayIp = undefined;

      await db.run("UPDATE printers SET status = 'DISCONNECTED', updated_at = datetime('now')");
      socketService.emitPrinterStatus('all', 'DISCONNECTED', 'Wi-Fi interface disconnected');
      await notificationService.notifyHardwareAlert('DISCONNECTED', 'Wi-Fi interface disconnected.');

      return {
        stage: 'DISCONNECTED',
        printerStatus: 'DISCONNECTED',
        details: 'Wi-Fi disconnected.',
      };
    }

    this.currentConnectedSsid = event.ssid;
    this.currentGatewayIp = event.gatewayIp;

    // Check if connected network matches HP Smart Tank 580 Wi-Fi Direct format (DIRECT-*)
    const isWfd = event.ssid && (event.ssid.startsWith('DIRECT-') || event.ssid.includes('HP Smart Tank 580'));

    if (isWfd) {
      this.currentNetworkStage = 'NETWORK_DETECTED';
    }

    // Attempt probe on discovered gateway IP
    const targetIp = event.gatewayIp || '192.168.223.1';
    const adapter = this.getAdapter();

    const reachability = await adapter.probeReachability(targetIp, 631, 2000);

    if (!reachability.reachable) {
      const rawReachability = await adapter.probeReachability(targetIp, 9100, 2000);
      if (!rawReachability.reachable) {
        // Network joined, but printer socket not reachable yet
        const status = isWfd ? 'NETWORK_DETECTED' : 'DISCONNECTED';
        this.currentNetworkStage = isWfd ? 'NETWORK_DETECTED' : 'DISCONNECTED';

        await db.run(
          "UPDATE printers SET status = ?, ip_address = ?, updated_at = datetime('now') WHERE is_default = 1",
          [status, targetIp]
        );
        socketService.emitPrinterStatus('default', status, `Network detected (${event.ssid}), probing gateway ${targetIp}...`);

        return {
          stage: this.currentNetworkStage,
          printerStatus: status,
          details: `Connected to ${event.ssid}, but printer ports 631/9100 did not respond yet.`,
        };
      }
    }

    // IP and Port are reachable!
    this.currentNetworkStage = 'PROTOCOL_AVAILABLE';

    // Verify readiness
    const defaultPrinter = await db.get<PrinterRecord>('SELECT * FROM printers WHERE is_default = 1 LIMIT 1');
    if (defaultPrinter) {
      const updatedPrinter = { ...defaultPrinter, ip_address: targetIp };
      const readiness = await adapter.verifyReadiness(updatedPrinter);

      const finalStatus: PrinterStatus = readiness.isReady ? 'AVAILABLE' : 'BUSY';
      this.currentNetworkStage = readiness.isReady ? 'AVAILABLE' : 'PROTOCOL_AVAILABLE';

      await db.run(
        `UPDATE printers SET 
          status = ?, 
          ip_address = ?,
          wifi_direct_ssid = ?,
          bssid = ?,
          last_seen = datetime('now'),
          updated_at = datetime('now') 
        WHERE is_default = 1`,
        [finalStatus, targetIp, event.ssid || null, event.bssid || null]
      );

      socketService.emitPrinterStatus(
        defaultPrinter.id,
        finalStatus,
        readiness.reasons.join('; ')
      );

      // Trigger PrintBrain auto-resume for parked jobs when printer is AVAILABLE
      if (finalStatus === 'AVAILABLE') {
        await printBrainService.onPrinterAvailable(defaultPrinter.id);
      }

      // Check for specific hardware alerts
      const reasonsStr = readiness.reasons.join(' ').toLowerCase();
      if (reasonsStr.includes('jam')) {
        await notificationService.notifyHardwareAlert('PAPER_JAM', 'Paper jam detected in physical roller mechanism.');
      } else if (reasonsStr.includes('empty') || reasonsStr.includes('out of paper')) {
        await notificationService.notifyHardwareAlert('OUT_OF_PAPER', 'Printer paper tray is empty. Please load sheets.');
      } else if (reasonsStr.includes('door') || reasonsStr.includes('cover')) {
        await notificationService.notifyHardwareAlert('DOOR_OPEN', 'Printer front door or top scanner cover is open.');
      }

      return {
        stage: this.currentNetworkStage,
        printerStatus: finalStatus,
        details: readiness.reasons.join('; '),
      };
    }

    return {
      stage: this.currentNetworkStage,
      printerStatus: 'AVAILABLE',
      details: 'Printer protocol reachable.',
    };
  }

  /**
   * Run full discovery across candidate gateways.
   */
  public async discoverPrinters(gatewayIp?: string): Promise<PrinterDiscoveryResult[]> {
    const adapter = this.getAdapter();
    const results = await adapter.discover({
      gatewayIp: gatewayIp || this.currentGatewayIp,
      timeoutMs: 1500,
    });

    if (results.length > 0) {
      const top = results[0];
      // Update default printer with discovered IP and port
      await db.run(
        `UPDATE printers SET 
          ip_address = ?, 
          port = ?, 
          protocol = ?, 
          status = 'AVAILABLE',
          last_seen = datetime('now'),
          updated_at = datetime('now')
        WHERE is_default = 1`,
        [top.ip, top.port, top.protocol]
      );

      socketService.emitPrinterStatus('default', 'AVAILABLE', `Discovered at ${top.ip}:${top.port}`);
    }

    return results;
  }

  /**
   * Check physical readiness of a specific registered printer.
   */
  public async checkPrinterReadiness(printerId: string): Promise<PrinterReadinessResult> {
    const printer = await db.get<PrinterRecord>('SELECT * FROM printers WHERE id = ?', [printerId]);
    if (!printer) {
      return {
        isReady: false,
        state: 'unreachable',
        reasons: ['Printer record not found in database.'],
        latencyMs: -1,
      };
    }

    const adapter = this.getAdapter(printer.model);
    const result = await adapter.verifyReadiness(printer);

    const newStatus: PrinterStatus = result.isReady ? 'AVAILABLE' : result.state === 'processing' ? 'BUSY' : 'DISCONNECTED';
    await db.run(
      "UPDATE printers SET status = ?, last_seen = datetime('now'), updated_at = datetime('now') WHERE id = ?",
      [newStatus, printerId]
    );

    socketService.emitPrinterStatus(printerId, newStatus, result.reasons.join('; '));

    return result;
  }

  public getCurrentStage(): NetworkStage {
    return this.currentNetworkStage;
  }

  public getCurrentNetwork(): { ssid?: string; gatewayIp?: string } {
    return {
      ssid: this.currentConnectedSsid,
      gatewayIp: this.currentGatewayIp,
    };
  }
}

export const printerService = PrinterService.getInstance();
