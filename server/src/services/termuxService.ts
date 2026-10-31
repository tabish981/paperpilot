import { exec } from 'child_process';
import util from 'util';
import fs from 'fs';

const execAsync = util.promisify(exec);

export interface TermuxBatteryInfo {
  percentage: number;
  isPluggedIn: boolean;
  temperatureCelsius?: number;
  status: string;
}

/**
 * Termux Native Android Integration Service
 *
 * Provides wake locks, hardware battery queries, and system notifications
 * directly from the Termux Node.js process without requiring Google Play Services.
 */
export class TermuxService {
  private static instance: TermuxService;
  private isTermuxEnvironment: boolean = false;
  private isWakeLockHeld: boolean = false;

  private constructor() {
    this.detectEnvironment();
  }

  public static getInstance(): TermuxService {
    if (!TermuxService.instance) {
      TermuxService.instance = new TermuxService();
    }
    return TermuxService.instance;
  }

  private detectEnvironment(): void {
    this.isTermuxEnvironment =
      Boolean(process.env.TERMUX_VERSION) ||
      Boolean(process.env.PREFIX?.includes('com.termux')) ||
      fs.existsSync('/data/data/com.termux');

    if (this.isTermuxEnvironment) {
      console.log('[TermuxService] Running inside Android Termux environment.');
    } else {
      console.log('[TermuxService] Running in standard Node.js development mode (Termux commands mocked).');
    }
  }

  public isTermux(): boolean {
    return this.isTermuxEnvironment;
  }

  /**
   * Acquire Android CPU wake lock so Node.js and socket connections
   * continue processing when the phone screen turns off.
   */
  public async acquireWakeLock(): Promise<boolean> {
    if (this.isWakeLockHeld) return true;

    if (this.isTermuxEnvironment) {
      try {
        await execAsync('termux-wake-lock');
        this.isWakeLockHeld = true;
        console.log('[TermuxService] termux-wake-lock acquired successfully.');
        return true;
      } catch (err: unknown) {
        console.warn('[TermuxService] Failed to acquire termux-wake-lock:', err);
        return false;
      }
    } else {
      this.isWakeLockHeld = true;
      return true;
    }
  }

  /**
   * Release CPU wake lock when queue finishes to conserve battery.
   */
  public async releaseWakeLock(): Promise<boolean> {
    if (!this.isWakeLockHeld) return true;

    if (this.isTermuxEnvironment) {
      try {
        await execAsync('termux-wake-unlock');
        this.isWakeLockHeld = false;
        console.log('[TermuxService] termux-wake-unlock released successfully.');
        return true;
      } catch (err: unknown) {
        console.warn('[TermuxService] Failed to release termux-wake-unlock:', err);
        return false;
      }
    } else {
      this.isWakeLockHeld = false;
      return true;
    }
  }

  /**
   * Send a system notification using Termux API.
   */
  public async sendNotification(options: {
    id?: number;
    title: string;
    content: string;
    priority?: 'low' | 'high' | 'max';
    ongoing?: boolean;
    sound?: boolean;
    vibrate?: number[];
  }): Promise<boolean> {
    if (this.isTermuxEnvironment) {
      try {
        const idFlag = options.id ? `--id "${options.id}"` : '';
        const prioFlag = options.priority ? `--priority "${options.priority}"` : '--priority "high"';
        const ongoingFlag = options.ongoing ? '--ongoing' : '';
        const soundFlag = options.sound ? '--sound' : '';
        const vibrateFlag = options.vibrate ? `--vibrate "${options.vibrate.join(',')}"` : '';

        const cmd = `termux-notification --title "${options.title}" --content "${options.content}" ${idFlag} ${prioFlag} ${ongoingFlag} ${soundFlag} ${vibrateFlag}`;
        await execAsync(cmd);
        return true;
      } catch (err: unknown) {
        console.warn('[TermuxService] Failed to invoke termux-notification:', err);
        return false;
      }
    } else {
      console.log(`[TermuxService Mock Notification] [${options.priority || 'high'}] ${options.title}: ${options.content}`);
      return true;
    }
  }

  /**
   * Queries battery level and charging status via termux-battery-status.
   */
  public async getBatteryStatus(): Promise<TermuxBatteryInfo> {
    if (this.isTermuxEnvironment) {
      try {
        const { stdout } = await execAsync('termux-battery-status');
        const data = JSON.parse(stdout);
        return {
          percentage: data.percentage ?? 100,
          isPluggedIn: data.plugged !== 'UNPLUGGED',
          temperatureCelsius: data.temperature ? data.temperature / 10 : undefined,
          status: data.status || 'UNKNOWN',
        };
      } catch {
        return { percentage: 100, isPluggedIn: true, status: 'CHARGING' };
      }
    }

    // Default mock response for dev
    return {
      percentage: 85,
      isPluggedIn: true,
      temperatureCelsius: 28.5,
      status: 'CHARGING',
    };
  }
}

export const termuxService = TermuxService.getInstance();
