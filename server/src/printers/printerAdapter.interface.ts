import { PrinterRecord, PrinterStatus, PrinterCapabilities } from '@paperpilot/shared';

export interface PrinterDiscoveryResult {
  ip: string;
  port: number;
  protocol: 'ipp' | 'raw';
  model: string;
  reachable: boolean;
  latencyMs: number;
  ssid?: string;
  gatewayIp?: string;
  capabilities: PrinterCapabilities;
}

export interface PrinterReadinessResult {
  isReady: boolean;
  state: 'idle' | 'processing' | 'stopped' | 'unreachable';
  reasons: string[];
  latencyMs: number;
  details?: Record<string, unknown>;
}

/**
 * Common interface for printer adapters.
 * Enables pluggable support for HP, Canon, Epson, and Brother printers.
 */
export interface PrinterAdapter {
  readonly modelName: string;

  /**
   * Probes candidate gateway IPs and subnets to discover the printer.
   */
  discover(options?: {
    candidateIps?: string[];
    gatewayIp?: string;
    timeoutMs?: number;
  }): Promise<PrinterDiscoveryResult[]>;

  /**
   * Inspects network reachability and response latency for a specific printer IP and port.
   */
  probeReachability(
    ip: string,
    port: number,
    timeoutMs?: number
  ): Promise<{ reachable: boolean; latencyMs: number }>;

  /**
   * Verifies if the printer is actually ready to accept jobs (checks engine state, ink, paper).
   */
  verifyReadiness(printer: PrinterRecord): Promise<PrinterReadinessResult>;

  /**
   * Returns default hardware capabilities for this printer model.
   */
  getHardwareCapabilities(): PrinterCapabilities;

  /**
   * Transmits a print job to the physical printer using the adapter's protocol (IPP/RAW).
   */
  submitPrintJob(
    printer: PrinterRecord,
    job: any,
    documentBytes: Buffer
  ): Promise<{
    success: boolean;
    ippJobId?: number;
    status: string;
    errorMessage?: string;
  }>;

  /**
   * Queries job state and physical sheet progression from printer firmware.
   */
  getJobAttributes(
    printer: PrinterRecord,
    ippJobId: number
  ): Promise<{
    jobState: 'pending' | 'processing' | 'completed' | 'canceled' | 'aborted' | 'unknown';
    impressionsCompleted: number;
    details?: string;
  }>;

  /**
   * Cancels an active print job on the physical printer.
   */
  cancelPrintJob(printer: PrinterRecord, ippJobId: number): Promise<boolean>;
}
