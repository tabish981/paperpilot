process.env.PAPERPILOT_SIMULATE_PRINTING = 'true';
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { PDFDocument } from 'pdf-lib';
import { db } from '../database/connection';
import { runMigrations } from '../database/migrations';
import { initializeStorageDirectories, STORAGE_PATHS } from '../utils/storage';
import { queueWorker } from '../workers/queueWorker';
import { QueueController } from '../controllers/queueController';
import { PrintJobRecord, PrintJobCheckpointRecord } from '@paperpilot/shared';

async function runTests() {
  console.log('========================================================');
  console.log('   Running PaperPilot Phase 3 Queue Worker Tests        ');
  console.log('========================================================');

  initializeStorageDirectories();
  await runMigrations();

  const testTempDir = path.join(STORAGE_PATHS.BASE, 'test_temp_queue');
  if (!fs.existsSync(testTempDir)) {
    fs.mkdirSync(testTempDir, { recursive: true });
  }

  // Create a 2-page test PDF
  const testPdfPath = path.join(testTempDir, 'queue_test.pdf');
  const pdfDoc = await PDFDocument.create();
  pdfDoc.addPage([595.28, 841.89]);
  pdfDoc.addPage([595.28, 841.89]);
  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync(testPdfPath, pdfBytes);

  const docId = uuidv4();
  const storedName = `queue_test_${Date.now()}.pdf`;
  await db.run(
    `INSERT INTO documents (
      id, original_name, stored_filename, file_path, file_size, mime_type, sha256_hash, page_count, is_processed
    ) VALUES (?, 'queue_test.pdf', ?, ?, ?, 'application/pdf', ?, 2, 0)`,
    [docId, storedName, testPdfPath, pdfBytes.length, `mock_hash_${Date.now()}`]
  );

  // Clean queue before testing
  await db.run('DELETE FROM print_jobs');
  await db.run('DELETE FROM print_job_checkpoints');
  await db.run('DELETE FROM print_job_events');
  await db.run('DELETE FROM application_settings WHERE key = "queue_paused"');

  // --- Test 1: Priority Sequential Execution Order ---
  console.log('\n[Test 1] Testing Priority-Based Sequential Scheduling...');
  // Job Normal: Priority 50
  const jobNormalId = uuidv4();
  await db.run(
    `INSERT INTO print_jobs (
      id, document_id, copies, page_range, paper_size, orientation, color_mode, duplex_mode, priority, queue_position, status
    ) VALUES (?, ?, 1, 'all', 'A4', 'portrait', 'monochrome', 'simplex', 50, 1, 'PENDING')`,
    [jobNormalId, docId]
  );

  // Job Urgent: Priority 10 (Inserted after, but has higher priority!)
  const jobUrgentId = uuidv4();
  await db.run(
    `INSERT INTO print_jobs (
      id, document_id, copies, page_range, paper_size, orientation, color_mode, duplex_mode, priority, queue_position, status
    ) VALUES (?, ?, 1, 'all', 'A4', 'portrait', 'monochrome', 'simplex', 10, 2, 'PENDING')`,
    [jobUrgentId, docId]
  );

  // Process next job: Must pick Job Urgent first despite being inserted second
  await queueWorker.processNextJob();

  const urgentAfter = await db.get<PrintJobRecord>('SELECT * FROM print_jobs WHERE id = ?', [jobUrgentId]);
  const normalAfter = await db.get<PrintJobRecord>('SELECT * FROM print_jobs WHERE id = ?', [jobNormalId]);

  assert.strictEqual(urgentAfter?.status, 'COMPLETED', 'Urgent job (P10) should have completed first');
  assert.strictEqual(normalAfter?.status, 'PENDING', 'Normal job (P50) should remain PENDING until its turn');
  console.log('✓ Priority ordering verified: Priority 10 executed before Priority 50.');

  // Process again: Now Normal job executes
  await queueWorker.processNextJob();
  const normalAfter2 = await db.get<PrintJobRecord>('SELECT * FROM print_jobs WHERE id = ?', [jobNormalId]);
  assert.strictEqual(normalAfter2?.status, 'COMPLETED', 'Normal job (P50) should now be COMPLETED');
  console.log('✓ Normal job completed sequentially.');

  // --- Test 2: Checkpoint Persistence ---
  console.log('\n[Test 2] Verifying Checkpoint Persistence for Completed Jobs...');
  const checkpoints = await db.all<PrintJobCheckpointRecord>(
    'SELECT * FROM print_job_checkpoints WHERE job_id = ? ORDER BY copy_index ASC, completed_page ASC',
    [jobUrgentId]
  );
  assert.strictEqual(checkpoints.length, 2, '2-page document should generate exactly 2 checkpoints');
  assert.strictEqual(checkpoints[0].completed_page, 1, 'Checkpoint 1 should be page 1');
  assert.strictEqual(checkpoints[1].completed_page, 2, 'Checkpoint 2 should be page 2');
  assert.strictEqual(checkpoints[1].is_verified_by_sensor, 1, 'Checkpoint should record sensor verification');
  console.log('✓ Physical sheet checkpoints accurately verified and stored in SQLite.');

  // --- Test 3: Global Queue Pause & Resume ---
  console.log('\n[Test 3] Testing Global Queue Pause & Resume...');
  const jobPausedTestId = uuidv4();
  await db.run(
    `INSERT INTO print_jobs (
      id, document_id, copies, page_range, paper_size, orientation, color_mode, duplex_mode, priority, queue_position, status
    ) VALUES (?, ?, 1, 'all', 'A4', 'portrait', 'monochrome', 'simplex', 50, 1, 'PENDING')`,
    [jobPausedTestId, docId]
  );

  // Pause queue globally
  await db.run(
    'INSERT OR REPLACE INTO application_settings (key, value, updated_at) VALUES ("queue_paused", "true", datetime("now"))'
  );

  await queueWorker.processNextJob();
  const jobWhilePaused = await db.get<PrintJobRecord>('SELECT * FROM print_jobs WHERE id = ?', [jobPausedTestId]);
  assert.strictEqual(jobWhilePaused?.status, 'PENDING', 'Job must NOT execute when global queue is paused');
  console.log('✓ Global pause enforced: Worker skips processing.');

  // Resume queue globally
  await db.run(
    'INSERT OR REPLACE INTO application_settings (key, value, updated_at) VALUES ("queue_paused", "false", datetime("now"))'
  );
  await queueWorker.processNextJob();
  const jobAfterResume = await db.get<PrintJobRecord>('SELECT * FROM print_jobs WHERE id = ?', [jobPausedTestId]);
  assert.strictEqual(jobAfterResume?.status, 'COMPLETED', 'Job should execute once global pause is lifted');
  console.log('✓ Global resume verified: Execution proceeded cleanly.');

  // --- Test 4: Crash & Orphan Recovery Simulation ---
  console.log('\n[Test 4] Testing Unclean Server Restart / Orphan Recovery...');
  const stuckJobId = uuidv4();
  await db.run(
    `INSERT INTO print_jobs (
      id, document_id, copies, page_range, paper_size, orientation, color_mode, duplex_mode, priority, queue_position, status, last_confirmed_page
    ) VALUES (?, ?, 2, 'all', 'A4', 'portrait', 'monochrome', 'simplex', 50, 1, 'PRINTING', 1)`,
    [stuckJobId, docId]
  );
  // Add 1 checkpoint to simulate Page 1 printed before crash
  await db.run(
    `INSERT INTO print_job_checkpoints (
      id, job_id, copy_index, completed_page, total_pages, is_verified_by_sensor, user_confirmed
    ) VALUES (?, ?, 1, 1, 2, 1, 0)`,
    [uuidv4(), stuckJobId]
  );

  // Trigger crash recovery
  await queueWorker.recoverOrphanedJobs();

  const recoveredJob = await db.get<PrintJobRecord>('SELECT * FROM print_jobs WHERE id = ?', [stuckJobId]);
  assert.strictEqual(recoveredJob?.status, 'NEEDS_CONFIRMATION', 'Stuck job with checkpoints must transition to NEEDS_CONFIRMATION');
  assert.ok(recoveredJob?.error_message?.includes('Server restarted'), 'Error message should indicate crash recovery');
  console.log('✓ Crash recovery verified: Stuck in-flight job safely flagged for NEEDS_CONFIRMATION.');

  // --- Test 5: Queue Reordering ---
  console.log('\n[Test 5] Testing Queue Reordering...');
  const j1 = uuidv4();
  const j2 = uuidv4();
  await db.run(
    `INSERT INTO print_jobs (id, document_id, copies, page_range, paper_size, orientation, color_mode, duplex_mode, priority, queue_position, status)
     VALUES (?, ?, 1, 'all', 'A4', 'portrait', 'monochrome', 'simplex', 50, 1, 'PAUSED')`,
    [j1, docId]
  );
  await db.run(
    `INSERT INTO print_jobs (id, document_id, copies, page_range, paper_size, orientation, color_mode, duplex_mode, priority, queue_position, status)
     VALUES (?, ?, 1, 'all', 'A4', 'portrait', 'monochrome', 'simplex', 50, 2, 'PAUSED')`,
    [j2, docId]
  );

  // Reorder so j2 is at position 1 and j1 is at position 2
  await db.run("UPDATE print_jobs SET queue_position = 1 WHERE id = ?", [j2]);
  await db.run("UPDATE print_jobs SET queue_position = 2 WHERE id = ?", [j1]);

  const activeQueue = await QueueController.fetchActiveQueue();
  const indexJ2 = activeQueue.findIndex((j) => j.id === j2);
  const indexJ1 = activeQueue.findIndex((j) => j.id === j1);
  assert.ok(indexJ2 < indexJ1, 'j2 should appear before j1 in active queue after reordering');
  console.log('✓ Queue reordering verified.');

  console.log('\n========================================================');
  console.log('   ALL PHASE 3 QUEUE WORKER TESTS PASSED PERFECTLY!     ');
  console.log('========================================================\n');
}

runTests().catch((err) => {
  console.error('[TEST ERROR]', err);
  process.exit(1);
});
