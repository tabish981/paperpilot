import { io, Socket } from 'socket.io-client';
import {
  ServerToClientEvents,
  ClientToServerEvents,
} from '@paperpilot/shared';

export class MobileSocketClient {
  private static instance: MobileSocketClient;
  private socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
  private serverUrl: string = 'http://127.0.0.1:5000';

  public static getInstance(): MobileSocketClient {
    if (!MobileSocketClient.instance) {
      MobileSocketClient.instance = new MobileSocketClient();
    }
    return MobileSocketClient.instance;
  }

  public connect(url: string = this.serverUrl): void {
    if (this.socket) {
      this.socket.disconnect();
    }

    this.serverUrl = url;
    this.socket = io(this.serverUrl, {
      transports: ['websocket'],
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
    });

    this.socket.on('connect', () => {
      console.log(`[MobileSocket] Connected to backend at ${this.serverUrl}`);
      this.socket?.emit('subscribe:queue');
    });

    this.socket.on('connect_error', (err) => {
      console.warn(`[MobileSocket] Connection error:`, err.message);
    });
  }

  public getSocket(): Socket<ServerToClientEvents, ClientToServerEvents> | null {
    return this.socket;
  }

  public disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}

export const mobileSocket = MobileSocketClient.getInstance();
