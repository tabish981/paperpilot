import { v4 as uuidv4 } from 'uuid';
import { socketService } from './socketService';
import { termuxService } from './termuxService';
import { NotificationPayload } from '@paperpilot/shared';

export type AlertType =
  | 'DOOR_OPEN'
  | 'OUT_OF_PAPER'
  | 'PAPER_JAM'
  | 'LOW_INK'
  | 'DISCONNECTED'
  | 'DUPLEX_REFEED'
  | 'RECOVERY_NEEDED';

/**
 * Unified Notification Service
 *
 * Dispatches notifications simultaneously to:
 * 1. Mobile UI via WebSocket events ('notification:new', 'job:progress')
 * 2. Android System Notification shade via Termux CLI ('termux-notification')
 */
export class NotificationService {
  private static instance: NotificationService;

  private constructor() {}

  public static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  /**
   * Broadcast sheet printing progress.
   */
  public async notifyJobProgress(
    jobId: string,
    sheetIndex: number,
    totalSheets: number,
    copyIndex: number,
    totalCopies: number
  ): Promise<void> {
    const title = `Printing Job #${jobId.substring(0, 8)}`;
    const content = `Copy ${copyIndex}/${totalCopies} • Sheet ${sheetIndex} of ${totalSheets}`;

    // 1. WebSocket broadcast
    socketService.emitJobProgress(jobId, 'PRINTING', copyIndex, sheetIndex, totalSheets);

    // 2. Termux ongoing notification with low CPU wake lock
    await termuxService.acquireWakeLock();
    await termuxService.sendNotification({
      id: 1001,
      title,
      content,
      priority: 'high',
      ongoing: true,
    });
  }

  /**
   * Broadcast print job completion.
   */
  public async notifyJobCompleted(
    jobId: string,
    docName: string,
    totalSheets: number
  ): Promise<void> {
    const payload: NotificationPayload = {
      id: uuidv4(),
      title: 'Print Completed',
      message: `Successfully printed ${totalSheets} sheet(s) of "${docName}".`,
      channel: 'print_progress',
      job_id: jobId,
      timestamp: new Date().toISOString(),
    };

    socketService.emitNotification(payload);

    await termuxService.sendNotification({
      id: 1001,
      title: 'Print Completed',
      content: `Finished printing ${totalSheets} sheet(s) of "${docName}".`,
      priority: 'high',
      ongoing: false,
      sound: true,
    });
  }

  /**
   * Prompt user to flip and re-feed paper for manual duplex.
   */
  public async notifyDuplexRefeed(jobId: string, completedOddCount: number): Promise<void> {
    const payload: NotificationPayload = {
      id: uuidv4(),
      title: 'Action Required: Flip Paper',
      message: `Odd pages printed (${completedOddCount} sheets). Re-insert paper into HP Smart Tank 580 tray and tap Continue.`,
      channel: 'alerts',
      job_id: jobId,
      timestamp: new Date().toISOString(),
    };

    socketService.emitNotification(payload);

    await termuxService.sendNotification({
      id: 1002,
      title: 'Action Required: Flip Paper',
      content: 'Re-insert printed sheets into input tray to print even pages.',
      priority: 'max',
      sound: true,
      vibrate: [0, 300, 200, 300],
    });
  }

  /**
   * Broadcast hardware error alerts (Door open, out of paper, paper jam, low ink).
   */
  public async notifyHardwareAlert(
    alertType: AlertType,
    message: string,
    printerName: string = 'HP Smart Tank 580'
  ): Promise<void> {
    const titles: Record<AlertType, string> = {
      DOOR_OPEN: 'Printer Door Open',
      OUT_OF_PAPER: 'Printer Out of Paper',
      PAPER_JAM: 'Paper Jam Detected',
      LOW_INK: 'Low Ink Warning',
      DISCONNECTED: 'Printer Wi-Fi Direct Disconnected',
      DUPLEX_REFEED: 'Paper Re-feed Required',
      RECOVERY_NEEDED: 'Interrupted Print Recovery Required',
    };

    const title = `${printerName}: ${titles[alertType] || 'Hardware Alert'}`;

    const payload: NotificationPayload = {
      id: uuidv4(),
      title,
      message,
      channel: 'alerts',
      timestamp: new Date().toISOString(),
    };

    socketService.emitNotification(payload);

    await termuxService.sendNotification({
      id: 1003,
      title,
      content: message,
      priority: 'max',
      sound: true,
      vibrate: [0, 500, 200, 500],
    });
  }
}

export const notificationService = NotificationService.getInstance();
