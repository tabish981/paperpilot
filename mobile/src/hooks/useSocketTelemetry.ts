/**
 * useSocketTelemetry
 *
 * Central real-time communication hook that maintains a persistent WebSocket
 * connection to the PaperPilot server and dispatches events into:
 *  - Native Android notification channel (progress bars, alerts)
 *  - Zustand store (queue updates, job progress, printer status)
 *
 * Events handled:
 *  - job:progress          → Progress notification bar + store update
 *  - job:needs_duplex      → Native alert for manual duplex confirmation
 *  - job:completed         → Completion alert + clear progress
 *  - job:failed            → Error alert
 *  - queue:updated         → Refresh queue in store
 *  - printer:status        → Update printer online/offline state
 *  - notification:new      → Generic server-side notification
 *  - server:health         → Health data broadcast
 */
import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { mobileSocket } from '../services/socket';
import { NotificationClient } from '../services/notificationClient';
import { useAppStore } from '../store/useAppStore';

export function useSocketTelemetry(serverUrl: string = 'http://127.0.0.1:5000') {
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // Connect the singleton socket
    mobileSocket.connect(serverUrl);
    const socket = mobileSocket.getSocket();
    if (!socket) return;

    // -- Initialize store socket listeners (queue:updated, printer:status, job:progress, server:health)
    useAppStore.getState().initializeSocketListeners();

    // -- Native notification: Print progress
    socket.on('job:progress', (data: {
      jobId: string;
      status: string;
      copy: number;
      page: number;
      totalPages: number;
    }) => {
      if (data.status === 'PRINTING') {
        NotificationClient.showProgress({
          jobId: data.jobId,
          title: `Printing (Copy ${data.copy})`,
          currentSheet: data.page,
          totalSheets: data.totalPages,
        });
      }
    });

    // -- Manual duplex: prompt user to re-feed paper
    socket.on('job:needs_duplex' as any, (data: {
      jobId: string;
      documentName: string;
    }) => {
      NotificationClient.showProgress({
        jobId: data.jobId,
        title: 'Manual Duplex – Re-feed Paper',
        currentSheet: 0,
        totalSheets: 0,
        isDuplexAwaiting: true,
      });

      // Also raise an in-app alert
      Alert.alert(
        '🔄 Manual Duplex Required',
        `The odd pages for "${data.documentName}" have finished printing.\n\nPlease re-insert the printed stack face-down into the paper tray, then go to the Queue tab to confirm.`,
        [{ text: 'Go to Queue', style: 'default' }]
      );
    });

    // -- Job completed
    socket.on('job:completed' as any, (data: { jobId: string; documentName: string }) => {
      NotificationClient.cancelProgress();
      NotificationClient.showAlert(
        '✅ Print Completed',
        `"${data.documentName}" has been printed successfully.`,
        'INFO'
      );
    });

    // -- Job failed
    socket.on('job:failed' as any, (data: { jobId: string; documentName: string; error: string }) => {
      NotificationClient.cancelProgress();
      NotificationClient.showAlert(
        '❌ Print Failed',
        `"${data.documentName}" failed: ${data.error}`,
        'ERROR'
      );
    });

    // -- Generic server notifications
    socket.on('notification:new' as any, (notif: {
      title: string;
      message: string;
      type: string;
    }) => {
      const alertType = notif.type === 'ERROR' ? 'ERROR' : notif.type === 'WARNING' ? 'WARNING' : 'INFO';
      NotificationClient.showAlert(notif.title, notif.message, alertType);
    });

    // -- Cleanup: do NOT disconnect (keep connection alive for background events)
    return () => {
      // Persistent connection — intentionally kept alive
    };
  }, [serverUrl]);
}
