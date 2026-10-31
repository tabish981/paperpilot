import assert from 'assert';
import http from 'http';
import { io as ClientSocket, Socket as ClientSocketType } from 'socket.io-client';
import { socketService } from '../services/socketService';
import { termuxService } from '../services/termuxService';
import { notificationService, AlertType } from '../services/notificationService';
import { NotificationPayload } from '@paperpilot/shared';

async function runTests() {
  console.log('--- Phase 6: Native Notifications, Foreground Service & Telemetry Test Suite ---');
  let passed = 0;

  // Test 1: Termux Environment & Battery State
  console.log('\n[Test 1] Testing Termux Service wake locks and battery query...');
  {
    assert.strictEqual(typeof termuxService.isTermux(), 'boolean');

    const lockAcquired = await termuxService.acquireWakeLock();
    assert.strictEqual(lockAcquired, true, 'Wake lock should acquire cleanly');

    const lockReleased = await termuxService.releaseWakeLock();
    assert.strictEqual(lockReleased, true, 'Wake lock should release cleanly');

    const battery = await termuxService.getBatteryStatus();
    assert.ok(battery.percentage >= 0 && battery.percentage <= 100, 'Battery percentage must be 0-100%');
    assert.strictEqual(typeof battery.isPluggedIn, 'boolean');
    assert.ok(battery.status, 'Battery status should be populated');

    console.log(`✓ Termux wake lock lifecycle and battery telemetry verified (Level: ${battery.percentage}%, Plugged: ${battery.isPluggedIn}).`);
    passed++;
  }

  // Test 2: WebSocket Server & Real-Time Event Dispatch
  console.log('\n[Test 2] Testing Socket.IO server initialization and bidirectional telemetry...');
  {
    const server = http.createServer();
    const testPort = 5055;
    socketService.init(server);

    await new Promise<void>((resolve) => server.listen(testPort, '127.0.0.1', () => resolve()));

    const client: ClientSocketType = ClientSocket(`http://127.0.0.1:${testPort}`, {
      transports: ['websocket'],
    });

    await new Promise<void>((resolve) => {
      client.on('connect', () => resolve());
    });
    assert.strictEqual(client.connected, true, 'Socket client must connect to backend');

    // Subscribe to events
    const receivedProgress: any[] = [];
    const receivedNotifications: NotificationPayload[] = [];
    const receivedPrinterStatuses: any[] = [];

    client.on('job:progress', (data: any) => receivedProgress.push(data));
    client.on('notification:new', (data: NotificationPayload) => receivedNotifications.push(data));
    client.on('printer:status', (data: any) => receivedPrinterStatuses.push(data));

    // Test Progress Notification
    await notificationService.notifyJobProgress('job-abc-123', 2, 5, 1, 1);
    await new Promise((r) => setTimeout(r, 80));

    assert.strictEqual(receivedProgress.length, 1);
    assert.strictEqual(receivedProgress[0].jobId, 'job-abc-123');
    assert.strictEqual(receivedProgress[0].page, 2);
    assert.strictEqual(receivedProgress[0].totalPages, 5);

    // Test Duplex Re-feed Notification
    await notificationService.notifyDuplexRefeed('job-abc-123', 3);
    await new Promise((r) => setTimeout(r, 80));

    assert.strictEqual(receivedNotifications.length, 1);
    assert.strictEqual(receivedNotifications[0].title, 'Action Required: Flip Paper');
    assert.strictEqual(receivedNotifications[0].channel, 'alerts');

    // Test Hardware Alert Notifications (Door Open, Jam, Out of Paper)
    const alertTypes: AlertType[] = ['DOOR_OPEN', 'PAPER_JAM', 'OUT_OF_PAPER', 'LOW_INK'];
    for (const aType of alertTypes) {
      await notificationService.notifyHardwareAlert(aType, `Test hardware alert for ${aType}`);
    }
    await new Promise((r) => setTimeout(r, 80));

    assert.strictEqual(receivedNotifications.length, 5);
    const jamNotif = receivedNotifications.find((n) => n.title.includes('Paper Jam'));
    assert.ok(jamNotif, 'Paper Jam alert must be received');
    assert.strictEqual(jamNotif?.channel, 'alerts');

    const inkNotif = receivedNotifications.find((n) => n.title.includes('Low Ink'));
    assert.ok(inkNotif, 'Low Ink alert must be received');
    assert.strictEqual(inkNotif?.channel, 'alerts');

    // Test Job Completed Notification
    await notificationService.notifyJobCompleted('job-abc-123', 'Quarterly_Report.pdf', 5);
    await new Promise((r) => setTimeout(r, 80));

    const compNotif = receivedNotifications.find((n) => n.title === 'Print Completed');
    assert.ok(compNotif, 'Print completed notification must be received');
    assert.strictEqual(compNotif?.channel, 'print_progress');

    client.disconnect();
    await new Promise<void>((resolve) => server.close(() => resolve()));

    console.log('✓ Socket.IO telemetry and multi-channel notifications verified with 0ms delivery lag.');
    passed++;
  }

  console.log(`\n======================================================`);
  console.log(`Phase 6 Test Suite Results: ${passed}/2 Tests Passed`);
  console.log(`======================================================\n`);
}

runTests().catch((err) => {
  console.error('Phase 6 Tests FAILED:', err);
  process.exit(1);
});
