import { NativeModules, Platform } from 'react-native';

const { NotificationBridge } = NativeModules;

export interface ProgressNotificationOptions {
  jobId: string;
  title: string;
  currentSheet: number;
  totalSheets: number;
  isDuplexAwaiting?: boolean;
}

export class NotificationClient {
  public static async showProgress(options: ProgressNotificationOptions): Promise<void> {
    if (Platform.OS === 'android' && NotificationBridge) {
      try {
        await NotificationBridge.showProgressNotification(
          options.jobId,
          options.title,
          options.currentSheet,
          options.totalSheets,
          Boolean(options.isDuplexAwaiting)
        );
      } catch (err) {
        console.warn('[NotificationClient] Failed to show native progress notification:', err);
      }
    } else {
      console.log(`[NotificationClient Preview] Progress: Sheet ${options.currentSheet}/${options.totalSheets}`);
    }
  }

  public static async showAlert(
    title: string,
    message: string,
    alertType: 'ERROR' | 'WARNING' | 'INFO' = 'ERROR'
  ): Promise<void> {
    if (Platform.OS === 'android' && NotificationBridge) {
      try {
        await NotificationBridge.showAlertNotification(title, message, alertType);
      } catch (err) {
        console.warn('[NotificationClient] Failed to show native alert notification:', err);
      }
    } else {
      console.log(`[NotificationClient Preview] Alert [${alertType}] ${title}: ${message}`);
    }
  }

  public static async cancelProgress(): Promise<void> {
    if (Platform.OS === 'android' && NotificationBridge) {
      try {
        await NotificationBridge.cancelProgressNotification();
      } catch (err) {
        console.warn('[NotificationClient] Failed to cancel progress notification:', err);
      }
    }
  }
}
