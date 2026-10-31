import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { PDFDocument, rgb } from 'pdf-lib';
import { db } from '../database/connection';
import { runMigrations } from '../database/migrations';
import { initializeStorageDirectories, STORAGE_PATHS } from '../utils/storage';
import { validateFileSignature } from '../utils/fileValidation';
import { DocumentProcessor } from '../services/documentProcessor';
import { DocumentRecord } from '@paperpilot/shared';

async function runTests() {
  console.log('========================================================');
  console.log('   Running PaperPilot Phase 2 Document Tests            ');
  console.log('========================================================');

  // 1. Initialize environment
  initializeStorageDirectories();
  await runMigrations();

  const testTempDir = path.join(STORAGE_PATHS.BASE, 'test_temp');
  if (!fs.existsSync(testTempDir)) {
    fs.mkdirSync(testTempDir, { recursive: true });
  }

  // --- Test 1: Generate & Validate Genuine PDF ---
  console.log('\n[Test 1] Testing Genuine PDF Creation & Signature Validation...');
  const pdf1Path = path.join(testTempDir, 'sample1.pdf');
  const pdfDoc1 = await PDFDocument.create();
  const page1 = pdfDoc1.addPage([595.28, 841.89]);
  page1.drawText('PaperPilot Test Page 1', { x: 50, y: 750 });
  const page2 = pdfDoc1.addPage([595.28, 841.89]);
  page2.drawText('PaperPilot Test Page 2', { x: 50, y: 750 });
  const pdf1Bytes = await pdfDoc1.save();
  fs.writeFileSync(pdf1Path, pdf1Bytes);

  const val1 = await validateFileSignature(pdf1Path);
  assert.strictEqual(val1.isValid, true, 'PDF magic bytes should be valid');
  assert.strictEqual(val1.detectedType, 'application/pdf', 'Type should be application/pdf');
  assert.ok(val1.sha256.length === 64, 'SHA-256 should be 64-char hex');
  console.log('✓ PDF 1 validated (Pages: 2, SHA-256:', val1.sha256.substring(0, 12) + '...)');

  // --- Test 2: Reject Corrupted / Impostor File ---
  console.log('\n[Test 2] Rejecting Impostor File (Fake .pdf with text content)...');
  const fakePdfPath = path.join(testTempDir, 'fake.pdf');
  fs.writeFileSync(fakePdfPath, 'This is an impostor text file renamed to .pdf');
  const fakeVal = await validateFileSignature(fakePdfPath);
  assert.strictEqual(fakeVal.isValid, false, 'Fake PDF should be rejected');
  console.log('✓ Impostor file successfully rejected by binary signature check');

  // --- Test 3: Insert Document Record & Page Count ---
  console.log('\n[Test 3] Inserting Document 1 into SQLite...');
  const doc1Id = 'test-doc-1';
  await db.run(
    `INSERT OR REPLACE INTO documents (
      id, original_name, stored_filename, file_path, file_size, mime_type, sha256_hash, page_count, is_processed
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      doc1Id,
      'Sample1.pdf',
      'sample1.pdf',
      pdf1Path,
      pdf1Bytes.length,
      'application/pdf',
      val1.sha256,
      2,
    ]
  );
  const fetchedDoc1 = await db.get<DocumentRecord>('SELECT * FROM documents WHERE id = ?', [doc1Id]);
  assert.ok(fetchedDoc1, 'Document 1 should exist in SQLite');
  assert.strictEqual(fetchedDoc1.page_count, 2, 'Page count should be 2');
  console.log('✓ Document 1 record created with verified page count = 2');

  // --- Test 4: Create Second PDF for Merge/Split ---
  console.log('\n[Test 4] Generating Second PDF Document...');
  const pdf2Path = path.join(testTempDir, 'sample2.pdf');
  const pdfDoc2 = await PDFDocument.create();
  const pageB1 = pdfDoc2.addPage([595.28, 841.89]);
  pageB1.drawText('Second Document Page 1', { x: 50, y: 750 });
  const pdf2Bytes = await pdfDoc2.save();
  fs.writeFileSync(pdf2Path, pdf2Bytes);
  const val2 = await validateFileSignature(pdf2Path);

  const doc2Id = 'test-doc-2';
  await db.run(
    `INSERT OR REPLACE INTO documents (
      id, original_name, stored_filename, file_path, file_size, mime_type, sha256_hash, page_count, is_processed
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      doc2Id,
      'Sample2.pdf',
      'sample2.pdf',
      pdf2Path,
      pdf2Bytes.length,
      'application/pdf',
      val2.sha256,
      1,
    ]
  );
  console.log('✓ Document 2 created (Pages: 1)');

  // --- Test 5: Merge Documents ---
  console.log('\n[Test 5] Testing DocumentProcessor.mergePdfs...');
  const mergedDoc = await DocumentProcessor.mergePdfs([doc1Id, doc2Id], 'Merged_Output.pdf');
  assert.strictEqual(mergedDoc.page_count, 3, 'Merged PDF should have 2 + 1 = 3 pages');
  assert.strictEqual(mergedDoc.processing_type, 'MERGED', 'Processing type should be MERGED');
  assert.strictEqual(mergedDoc.is_processed, 1, 'is_processed should be 1');
  assert.ok(fs.existsSync(mergedDoc.file_path), 'Merged file should physically exist on disk');
  console.log(`✓ Merged PDF created successfully (Pages: ${mergedDoc.page_count}, Path: ${mergedDoc.stored_filename})`);

  // --- Test 6: Extract Pages ---
  console.log('\n[Test 6] Testing DocumentProcessor.extractPages...');
  const extractedDoc = await DocumentProcessor.extractPages(mergedDoc.id, '1, 3', 'Extracted_Pages.pdf');
  assert.strictEqual(extractedDoc.page_count, 2, 'Extracted PDF should have 2 pages');
  assert.strictEqual(extractedDoc.processing_type, 'EXTRACTED', 'Processing type should be EXTRACTED');
  console.log(`✓ Extracted PDF created successfully (Pages: ${extractedDoc.page_count})`);

  // --- Test 7: Split PDF ---
  console.log('\n[Test 7] Testing DocumentProcessor.splitPdf...');
  const splitSlices = await DocumentProcessor.splitPdf(mergedDoc.id, ['1-2', '3']);
  assert.strictEqual(splitSlices.length, 2, 'Should produce 2 slices');
  assert.strictEqual(splitSlices[0].page_count, 2, 'Slice 1 should have 2 pages');
  assert.strictEqual(splitSlices[1].page_count, 1, 'Slice 2 should have 1 page');
  console.log('✓ PDF split into 2 slices successfully');

  // --- Test 8: Convert Image to Print-Ready A4 PDF ---
  console.log('\n[Test 8] Testing DocumentProcessor.convertImagesToPdf with genuine PNG...');
  // Minimal valid 1x1 PNG bytes
  const minimalPng = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ]);
  const imgPath = path.join(testTempDir, 'test_image.png');
  fs.writeFileSync(imgPath, minimalPng);
  const imgVal = await validateFileSignature(imgPath);
  assert.strictEqual(imgVal.isValid, true, 'PNG signature should be valid');

  const imgDocId = 'test-image-1';
  await db.run(
    `INSERT OR REPLACE INTO documents (
      id, original_name, stored_filename, file_path, file_size, mime_type, sha256_hash, page_count, is_processed
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0)`,
    [
      imgDocId,
      'test_image.png',
      'test_image.png',
      imgPath,
      minimalPng.length,
      'image/png',
      imgVal.sha256,
    ]
  );

  const convertedPdf = await DocumentProcessor.convertImagesToPdf([imgDocId], 'ImageConverted.pdf', 'A4');
  assert.strictEqual(convertedPdf.page_count, 1, 'Converted PDF should have 1 page');
  assert.strictEqual(convertedPdf.processing_type, 'IMAGE_TO_PDF', 'Type should be IMAGE_TO_PDF');
  console.log('✓ Image converted to print-ready A4 PDF successfully');

  // --- Test 9: PDF Compression ---
  console.log('\n[Test 9] Testing DocumentProcessor.compressPdf...');
  const compResult = await DocumentProcessor.compressPdf(mergedDoc.id);
  assert.ok(compResult.compressedSize > 0, 'Compressed size should be positive');
  assert.ok(
    ['COMPRESSED', 'MERGED'].includes(compResult.document.processing_type as string),
    'Type should be COMPRESSED or deduplicated record'
  );
  console.log(`✓ PDF compressed successfully (${compResult.percentSaved}% reduction)`);

  console.log('\n========================================================');
  console.log('   ALL PHASE 2 DOCUMENT TESTS PASSED PERFECTLY!         ');
  console.log('========================================================\n');
}

runTests().catch((err) => {
  console.error('[TEST ERROR]', err);
  process.exit(1);
});
