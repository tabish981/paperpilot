import net from 'net';
import http from 'http';
import {
  PrinterAdapter,
  PrinterDiscoveryResult,
  PrinterReadinessResult,
} from './printerAdapter.interface';
import {
  PrinterRecord,
  PrinterCapabilities,
  HP_SMART_TANK_580,
} from '@paperpilot/shared';
import {
  IppProtocol,
  IPP_OPERATIONS,
  IPP_TAGS,
  IPP_STATUS_CODES,
  IppMessage,
} from './ippProtocol';
import { PclmGenerator } from './pclmGenerator';

export class HpSmartTank580Adapter implements PrinterAdapter {
  public readonly modelName = HP_SMART_TANK_580.MODEL_NAME;

  public getHardwareCapabilities(): PrinterCapabilities {
    return {
      supports_color: true,
      supports_duplex_manual: true,
      supports_duplex_auto: false,
      supported_media_sizes: ['A4', 'Letter', 'Legal', '4x6', '5x7'],
      supported_pdls: HP_SMART_TANK_580.SUPPORTED_PDLS,
      max_copies: 99,
      uri_supported: 'ipp://192.168.223.1:631/ipp/print',
      firmware_version: 'ST580_VER_2024',
    };
  }

  /**
   * Probe TCP port reachability with latency measurement.
   */
  public probeReachability(
    ip: string,
    port: number,
    timeoutMs: number = 2000
  ): Promise<{ reachable: boolean; latencyMs: number }> {
    return new Promise((resolve) => {
      const start = Date.now();
      const socket = new net.Socket();
      socket.setTimeout(timeoutMs);

      let settled = false;
      const finish = (reachable: boolean, latency: number) => {
        if (!settled) {
          settled = true;
          try {
            socket.destroy();
          } catch {}
          resolve({ reachable, latencyMs: latency });
        }
      };

      socket.on('connect', () => {
        finish(true, Date.now() - start);
      });

      socket.on('timeout', () => {
        finish(false, -1);
      });

      socket.on('error', () => {
        finish(false, -1);
      });

      socket.on('close', () => {
        finish(false, -1);
      });

      socket.connect(port, ip);
    });
  }

  /**
   * Discover HP Smart Tank 580 on candidate Wi-Fi Direct gateways and subnets.
   */
  public async discover(options?: {
    candidateIps?: string[];
    gatewayIp?: string;
    timeoutMs?: number;
  }): Promise<PrinterDiscoveryResult[]> {
    const candidateIps = new Set<string>();

    if (options?.gatewayIp) {
      candidateIps.add(options.gatewayIp);
    }
    candidateIps.add(HP_SMART_TANK_580.CANDIDATE_GATEWAY_IP);

    if (options?.candidateIps) {
      options.candidateIps.forEach((ip) => candidateIps.add(ip));
    }

    const timeout = options?.timeoutMs || 1500;
    const discovered: PrinterDiscoveryResult[] = [];

    for (const ip of Array.from(candidateIps)) {
      const ippProbe = await this.probeReachability(ip, HP_SMART_TANK_580.PORTS.IPP, timeout);
      if (ippProbe.reachable) {
        discovered.push({
          ip,
          port: HP_SMART_TANK_580.PORTS.IPP,
          protocol: 'ipp',
          model: this.modelName,
          reachable: true,
          latencyMs: ippProbe.latencyMs,
          capabilities: this.getHardwareCapabilities(),
        });
        continue;
      }

      const rawProbe = await this.probeReachability(ip, HP_SMART_TANK_580.PORTS.RAW_JETDIRECT, timeout);
      if (rawProbe.reachable) {
        discovered.push({
          ip,
          port: HP_SMART_TANK_580.PORTS.RAW_JETDIRECT,
          protocol: 'raw',
          model: this.modelName,
          reachable: true,
          latencyMs: rawProbe.latencyMs,
          capabilities: this.getHardwareCapabilities(),
        });
      }
    }

    return discovered;
  }

  /**
   * Verify printer readiness (IPP socket reachability + device status).
   */
  public async verifyReadiness(printer: PrinterRecord): Promise<PrinterReadinessResult> {
    const probe = await this.probeReachability(printer.ip_address, printer.port, 2500);

    if (!probe.reachable) {
      return {
        isReady: false,
        state: 'unreachable',
        reasons: [`Printer socket at ${printer.ip_address}:${printer.port} is unreachable.`],
        latencyMs: -1,
      };
    }

    const ewsStatus = await this.queryEwsStatus(printer.ip_address);

    if (ewsStatus && ewsStatus.state !== 'idle') {
      return {
        isReady: false,
        state: ewsStatus.state,
        reasons: ewsStatus.reasons,
        latencyMs: probe.latencyMs,
        details: ewsStatus.details,
      };
    }

    return {
      isReady: true,
      state: 'idle',
      reasons: ['Printer responded to IPP/RAW handshake and reports ready.'],
      latencyMs: probe.latencyMs,
      details: {
        model: this.modelName,
        protocol: printer.protocol,
        portsVerified: [printer.port],
      },
    };
  }

  /**
   * Submits a print job to the HP Smart Tank 580 using IPP 2.0 with PCLm raster encapsulation.
   */
  public async submitPrintJob(
    printer: PrinterRecord,
    job: any,
    documentBytes: Buffer
  ): Promise<{
    success: boolean;
    ippJobId?: number;
    status: string;
    errorMessage?: string;
  }> {
    try {
      // 1. Convert to PCLm raster stream format required by HP 580 firmware
      const pclmStream = await PclmGenerator.preparePclmStream(documentBytes, {
        colorMode: job.color_mode || 'monochrome',
        paperSize: job.paper_size || 'A4',
      });

      // 2. Build RFC 8011 IPP Print-Job request
      const printerUri = `ipp://${printer.ip_address}:${printer.port}/ipp/print`;
      const requestId = Math.floor(Math.random() * 900000) + 100000;

      const ippMsg: IppMessage = {
        operationIdOrStatus: IPP_OPERATIONS.PRINT_JOB,
        requestId,
        operationAttributes: [
          { tag: IPP_TAGS.CHARSET, name: 'attributes-charset', value: 'utf-8' },
          { tag: IPP_TAGS.NATURAL_LANGUAGE, name: 'attributes-natural-language', value: 'en' },
          { tag: IPP_TAGS.URI, name: 'printer-uri', value: printerUri },
          { tag: IPP_TAGS.NAME_WITHOUT_LANGUAGE, name: 'requesting-user-name', value: 'PaperPilot' },
          {
            tag: IPP_TAGS.NAME_WITHOUT_LANGUAGE,
            name: 'job-name',
            value: job.document?.original_name || 'PaperPilot Document',
          },
          { tag: IPP_TAGS.MIME_MEDIA_TYPE, name: 'document-format', value: 'application/PCLm' },
        ],
        jobAttributes: [
          { tag: IPP_TAGS.INTEGER, name: 'copies', value: job.copies || 1 },
          {
            tag: IPP_TAGS.KEYWORD,
            name: 'print-color-mode',
            value: job.color_mode === 'color' ? 'color' : 'monochrome',
          },
          { tag: IPP_TAGS.KEYWORD, name: 'sides', value: 'one-sided' }, // HP 580 is manual duplex only
          {
            tag: IPP_TAGS.KEYWORD,
            name: 'media',
            value: job.paper_size === 'Letter' ? 'na_letter_8.5x11in' : 'iso_a4_210x297mm',
          },
        ],
        data: pclmStream,
      };

      // 3. Dispatch HTTP POST request to Port 631
      const response = await IppProtocol.sendRequest(
        printer.ip_address,
        printer.port || 631,
        '/ipp/print',
        ippMsg,
        15000
      );

      if (response.operationIdOrStatus === IPP_STATUS_CODES.SUCCESSFUL_OK) {
        // Extract assigned job ID
        const jobIdAttr =
          response.jobAttributes?.find((a) => a.name === 'job-id') ||
          response.operationAttributes?.find((a) => a.name === 'job-id');

        const assignedJobId = jobIdAttr ? Number(jobIdAttr.value) : requestId;

        return {
          success: true,
          ippJobId: assignedJobId,
          status: 'SUBMITTED',
        };
      } else {
        return {
          success: false,
          status: 'FAILED',
          errorMessage: `Printer rejected job with IPP status code 0x${response.operationIdOrStatus.toString(16)}`,
        };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown IPP error';
      return {
        success: false,
        status: 'FAILED',
        errorMessage: msg,
      };
    }
  }

  /**
   * Polls job state and completed impressions count from printer IPP spooler.
   */
  public async getJobAttributes(
    printer: PrinterRecord,
    ippJobId: number
  ): Promise<{
    jobState: 'pending' | 'processing' | 'completed' | 'canceled' | 'aborted' | 'unknown';
    impressionsCompleted: number;
    details?: string;
  }> {
    try {
      const printerUri = `ipp://${printer.ip_address}:${printer.port}/ipp/print`;
      const requestId = Math.floor(Math.random() * 900000) + 100000;

      const queryMsg: IppMessage = {
        operationIdOrStatus: IPP_OPERATIONS.GET_JOB_ATTRIBUTES,
        requestId,
        operationAttributes: [
          { tag: IPP_TAGS.CHARSET, name: 'attributes-charset', value: 'utf-8' },
          { tag: IPP_TAGS.NATURAL_LANGUAGE, name: 'attributes-natural-language', value: 'en' },
          { tag: IPP_TAGS.URI, name: 'printer-uri', value: printerUri },
          { tag: IPP_TAGS.INTEGER, name: 'job-id', value: ippJobId },
        ],
      };

      const response = await IppProtocol.sendRequest(
        printer.ip_address,
        printer.port || 631,
        '/ipp/print',
        queryMsg,
        3000
      );

      if (response.operationIdOrStatus === IPP_STATUS_CODES.SUCCESSFUL_OK) {
        const stateAttr = response.jobAttributes?.find((a) => a.name === 'job-state');
        const impressionsAttr = response.jobAttributes?.find((a) => a.name === 'job-impressions-completed');

        // IPP job-state enum: 3=pending, 4=held, 5=processing, 6=stopped, 7=canceled, 8=aborted, 9=completed
        const rawState = stateAttr ? Number(stateAttr.value) : 5;
        let jobState: 'pending' | 'processing' | 'completed' | 'canceled' | 'aborted' | 'unknown' = 'processing';

        if (rawState === 3 || rawState === 4) jobState = 'pending';
        else if (rawState === 5) jobState = 'processing';
        else if (rawState === 7) jobState = 'canceled';
        else if (rawState === 8) jobState = 'aborted';
        else if (rawState === 9) jobState = 'completed';

        const impressionsCompleted = impressionsAttr ? Number(impressionsAttr.value) : 0;

        return {
          jobState,
          impressionsCompleted,
          details: `IPP State: ${jobState}, sheets completed: ${impressionsCompleted}`,
        };
      }

      return {
        jobState: 'unknown',
        impressionsCompleted: 0,
        details: `Get-Job-Attributes returned 0x${response.operationIdOrStatus.toString(16)}`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Get-Job-Attributes failed';
      return {
        jobState: 'unknown',
        impressionsCompleted: 0,
        details: msg,
      };
    }
  }

  /**
   * Cancels a print job on the physical printer.
   */
  public async cancelPrintJob(printer: PrinterRecord, ippJobId: number): Promise<boolean> {
    try {
      const printerUri = `ipp://${printer.ip_address}:${printer.port}/ipp/print`;
      const requestId = Math.floor(Math.random() * 900000) + 100000;

      const cancelMsg: IppMessage = {
        operationIdOrStatus: IPP_OPERATIONS.CANCEL_JOB,
        requestId,
        operationAttributes: [
          { tag: IPP_TAGS.CHARSET, name: 'attributes-charset', value: 'utf-8' },
          { tag: IPP_TAGS.NATURAL_LANGUAGE, name: 'attributes-natural-language', value: 'en' },
          { tag: IPP_TAGS.URI, name: 'printer-uri', value: printerUri },
          { tag: IPP_TAGS.INTEGER, name: 'job-id', value: ippJobId },
        ],
      };

      const res = await IppProtocol.sendRequest(
        printer.ip_address,
        printer.port || 631,
        '/ipp/print',
        cancelMsg,
        3000
      );

      return res.operationIdOrStatus === IPP_STATUS_CODES.SUCCESSFUL_OK;
    } catch {
      return false;
    }
  }

  /**
   * Query HP Embedded Web Server status over HTTP (Port 80).
   */
  private queryEwsStatus(
    ip: string,
    timeoutMs: number = 2000
  ): Promise<{ state: 'idle' | 'processing' | 'stopped'; reasons: string[]; details?: Record<string, unknown> } | null> {
    return new Promise((resolve) => {
      const req = http.get(
        `http://${ip}:80/DevMgmt/ProductStatusCap.xml`,
        { timeout: timeoutMs },
        (res) => {
          let body = '';
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => {
            if (body.includes('doorOpen') || body.includes('DoorOpen')) {
              resolve({
                state: 'stopped',
                reasons: ['Printer door or top cover is open.'],
              });
            } else if (body.includes('mediaEmpty') || body.includes('outOfPaper')) {
              resolve({
                state: 'stopped',
                reasons: ['Printer paper tray is empty.'],
              });
            } else if (body.includes('mediaJam') || body.includes('PaperJam')) {
              resolve({
                state: 'stopped',
                reasons: ['Paper jam detected in physical roller mechanism.'],
              });
            } else if (body.includes('busy') || body.includes('processing')) {
              resolve({
                state: 'processing',
                reasons: ['Printer is currently printing another job or running a calibration cycle.'],
              });
            } else {
              resolve({
                state: 'idle',
                reasons: ['EWS status indicates idle / ready.'],
              });
            }
          });
        }
      );

      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });

      req.on('error', () => {
        resolve(null);
      });
    });
  }
}
