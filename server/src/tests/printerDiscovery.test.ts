import assert from 'assert';
import net from 'net';
import { db } from '../database/connection';
import { runMigrations } from '../database/migrations';
import { HpSmartTank580Adapter } from '../printers/hpSmartTank580Adapter';
import { printerService } from '../services/printerService';
import { HP_SMART_TANK_580, PrinterRecord } from '@paperpilot/shared';

async function runTests() {
  console.log('========================================================');
  console.log('   Running PaperPilot Phase 4 Printer Discovery Tests   ');
  console.log('========================================================');

  await runMigrations();

  const adapter = new HpSmartTank580Adapter();

  // --- Test 1: Adapter Capabilities Inspection ---
  console.log('\n[Test 1] Inspecting HP Smart Tank 580 Adapter Capabilities...');
  const caps = adapter.getHardwareCapabilities();
  assert.strictEqual(caps.supports_color, true, 'HP 580 CISS must support color');
  assert.strictEqual(caps.supports_duplex_manual, true, 'HP 580 must support manual duplex');
  assert.strictEqual(caps.supports_duplex_auto, false, 'HP 580 does not have physical auto-duplex');
  assert.ok(caps.supported_pdls.includes('application/PCLm'), 'Must support PCLm raster');
  assert.ok(caps.supported_pdls.includes('image/urf'), 'Must support URF');
  console.log('✓ Hardware capabilities verified: Color CISS, Manual Duplex, PCLm & URF PDLs.');

  // --- Test 2: Unreachable IP Probe (Timeout Handling) ---
  console.log('\n[Test 2] Testing Timeout on Unreachable Candidate IP...');
  const unreachableProbe = await adapter.probeReachability('192.0.2.1', 631, 500);
  assert.strictEqual(unreachableProbe.reachable, false, 'Unreachable IP must return reachable: false');
  assert.strictEqual(unreachableProbe.latencyMs, -1, 'Unreachable latency should be -1');
  console.log('✓ Timeout handled safely with 0ms crash risk.');

  // --- Test 3: Active Local TCP Mock Probe ---
  console.log('\n[Test 3] Testing TCP Reachability on Active Port...');
  // Spin up a lightweight local mock server on dynamic port
  const mockServer = net.createServer((socket) => {
    socket.on('error', () => {});
    socket.end();
  });

  await new Promise<void>((resolve) => {
    mockServer.listen(0, '127.0.0.1', () => resolve());
  });

  const mockPort = (mockServer.address() as net.AddressInfo).port;
  const mockProbe = await adapter.probeReachability('127.0.0.1', mockPort, 1000);
  assert.strictEqual(mockProbe.reachable, true, 'Active port must be reachable');
  assert.ok(mockProbe.latencyMs >= 0, 'Latency must be measurable');
  console.log(`✓ Active socket probe succeeded with measured latency: ${mockProbe.latencyMs}ms.`);

  mockServer.close();

  // --- Test 4: 5-Stage Network State Ladder (Disconnection -> Detection) ---
  console.log('\n[Test 4] Testing Network Ladder: DISCONNECTED -> NETWORK_DETECTED...');
  // 4A: Disconnected
  const disconnectResult = await printerService.handleNetworkEvent({
    isConnected: false,
  });
  assert.strictEqual(disconnectResult.stage, 'DISCONNECTED', 'Stage must be DISCONNECTED');
  assert.strictEqual(printerService.getCurrentStage(), 'DISCONNECTED');
  console.log('✓ Disconnected state verified.');

  // 4B: Joined printer Wi-Fi Direct SSID (DIRECT-HP-SmartTank580)
  const networkDetectResult = await printerService.handleNetworkEvent({
    ssid: 'DIRECT-HP-SmartTank580',
    gatewayIp: '192.168.223.1',
    isConnected: true,
  });
  // Since 192.168.223.1 is not physically on this machine during unit test, stage is NETWORK_DETECTED
  assert.strictEqual(networkDetectResult.stage, 'NETWORK_DETECTED', 'Stage must be NETWORK_DETECTED when SSID matches');
  console.log('✓ Wi-Fi Direct SSID detection verified (State: NETWORK_DETECTED).');

  // --- Test 5: Full Readiness with Local Mock IPP Endpoint ---
  console.log('\n[Test 5] Testing Full Readiness Ladder Transition...');
  // Spin up mock IPP port
  const mockIppServer = net.createServer((socket) => {
    socket.on('error', () => {});
    socket.end();
  });

  await new Promise<void>((resolve) => {
    mockIppServer.listen(0, '127.0.0.1', () => resolve());
  });

  const ippPort = (mockIppServer.address() as net.AddressInfo).port;

  // Create a mock printer profile pointing to localhost ippPort
  const mockPrinterRecord: PrinterRecord = {
    id: 'mock-hp-printer',
    name: 'HP Smart Tank 580 (Test)',
    model: HP_SMART_TANK_580.MODEL_NAME,
    ip_address: '127.0.0.1',
    port: ippPort,
    protocol: 'ipp',
    is_default: true,
    capabilities: caps,
    status: 'UNKNOWN',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const readiness = await adapter.verifyReadiness(mockPrinterRecord);
  assert.strictEqual(readiness.isReady, true, 'Active IPP port must report isReady: true');
  assert.strictEqual(readiness.state, 'idle', 'State should be idle');
  console.log(`✓ Readiness verified: Responded in ${readiness.latencyMs}ms with state 'idle'.`);

  mockIppServer.close();

  console.log('\n========================================================');
  console.log('   ALL PHASE 4 PRINTER DISCOVERY TESTS PASSED!          ');
  console.log('========================================================\n');
}

runTests().catch((err) => {
  console.error('[TEST ERROR]', err);
  process.exit(1);
});
