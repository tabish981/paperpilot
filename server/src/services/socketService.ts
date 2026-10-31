import { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import {
  ServerToClientEvents,
  ClientToServerEvents,
  PrinterStatus,
  PrintJobRecord,
  JobStatus,
  PrintJobCheckpointRecord,
  ServerHealthResponse,
  NotificationPayload,
} from '@paperpilot/shared';

export class SocketService {
  private static instance: SocketService;
  private io: SocketIOServer<ClientToServerEvents, ServerToClientEvents> | null = null;

  public static getInstance(): SocketService {
    if (!SocketService.instance) {
      SocketService.instance = new SocketService();
    }
    return SocketService.instance;
  }

  public init(httpServer: HttpServer): void {
    this.io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(httpServer, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST'],
      },
    });

    this.io.on('connection', (socket) => {
      console.log(`[Socket.IO] Client connected: ${socket.id}`);

      socket.on('subscribe:printer', (printerId) => {
        socket.join(`printer:${printerId}`);
      });

      socket.on('subscribe:queue', () => {
        socket.join('queue');
      });

      socket.on('disconnect', () => {
        console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
      });
    });

    console.log('[Socket.IO] WebSocket server initialized.');
  }

  public emitPrinterStatus(printerId: string, status: PrinterStatus, details?: string): void {
    this.io?.emit('printer:status', { printerId, status, details });
  }

  public emitQueueUpdated(jobs: PrintJobRecord[]): void {
    this.io?.to('queue').emit('queue:updated', { jobs });
    this.io?.emit('queue:updated', { jobs });
  }

  public emitJobProgress(
    jobId: string,
    status: JobStatus,
    copy: number,
    page: number,
    totalPages: number
  ): void {
    this.io?.emit('job:progress', { jobId, status, copy, page, totalPages });
  }

  public emitJobInterrupted(
    jobId: string,
    checkpoint: PrintJobCheckpointRecord,
    needsConfirmation: boolean
  ): void {
    this.io?.emit('job:interrupted', { jobId, checkpoint, needsConfirmation });
  }

  public emitServerHealth(health: ServerHealthResponse): void {
    this.io?.emit('server:health', health);
  }

  public emitNotification(notification: NotificationPayload): void {
    this.io?.emit('notification:new', notification);
  }
}

export const socketService = SocketService.getInstance();
