import assert from 'assert';
import http from 'http';
import {
  IppProtocol,
  IPP_OPERATIONS,
  IPP_TAGS,
  IPP_STATUS_CODES,
  IppMessage,
  IppAttribute,
} from '../printers/ippProtocol';
import { PclmGenerator } from '../printers/pclmGenerator';
import { HpSmartTank580Adapter } from '../printers/hpSmartTank580Adapter';
import { PrinterRecord, PrintJobRecord } from '@paperpilot/shared';

async function runTests() {
  console.log('--- Phase 5: IPP Protocol & Printing Engine Test Suite ---');
  let passed = 0;

  // Minimal valid PDF structure for PDFDocument.load
  const dummyPdf = Buffer.from(
    '%PDF-1.7\n' +
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n' +
    'xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n' +
    'trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n186\n%%EOF'
  );

  // Test 1: IPP Message Encoding & Decoding Roundtrip
  console.log('\n[Test 1] Testing IPP RFC 8010/8011 binary encoder and decoder...');
  {
    const originalMsg: IppMessage = {
      operationIdOrStatus: IPP_OPERATIONS.PRINT_JOB,
      requestId: 54321,
      operationAttributes: [
        { tag: IPP_TAGS.CHARSET, name: 'attributes-charset', value: 'utf-8' },
        { tag: IPP_TAGS.NATURAL_LANGUAGE, name: 'attributes-natural-language', value: 'en-us' },
        { tag: IPP_TAGS.URI, name: 'printer-uri', value: 'ipp://192.168.223.1:631/ipp/print' },
        { tag: IPP_TAGS.NAME_WITHOUT_LANGUAGE, name: 'job-name', value: 'PaperPilot_Report.pdf' },
      ],
      jobAttributes: [
        { tag: IPP_TAGS.INTEGER, name: 'copies', value: 2 },
        { tag: IPP_TAGS.KEYWORD, name: 'sides', value: 'one-sided' },
        { tag: IPP_TAGS.KEYWORD, name: 'media', value: 'iso_a4_210x297mm' },
      ],
      data: Buffer.from('%PDF-1.7 Mock PDF Content For IPP Test Payload'),
    };

    const encoded = IppProtocol.encode(originalMsg);
    assert(encoded.length > 50, 'Encoded IPP payload must not be empty');

    // Check header
    assert.strictEqual(encoded[0], 0x02, 'Major version must be 2');
    assert.strictEqual(encoded[1], 0x00, 'Minor version must be 0');
    assert.strictEqual(encoded.readInt16BE(2), IPP_OPERATIONS.PRINT_JOB, 'Operation must be PRINT_JOB (0x0002)');
    assert.strictEqual(encoded.readInt32BE(4), 54321, 'Request ID must match');

    // Decode back
    const decoded = IppProtocol.decode(encoded);
    assert.strictEqual(decoded.operationIdOrStatus, IPP_OPERATIONS.PRINT_JOB);
    assert.strictEqual(decoded.requestId, 54321);

    const charsetAttr = decoded.operationAttributes?.find((a: IppAttribute) => a.name === 'attributes-charset');
    assert.strictEqual(charsetAttr?.value, 'utf-8');

    const jobNameAttr = decoded.operationAttributes?.find((a: IppAttribute) => a.name === 'job-name');
    assert.strictEqual(jobNameAttr?.value, 'PaperPilot_Report.pdf');

    const copiesAttr = decoded.jobAttributes?.find((a: IppAttribute) => a.name === 'copies');
    assert.strictEqual(copiesAttr?.value, 2);

    assert(decoded.data, 'Payload data must be preserved');
    assert(decoded.data!.toString().includes('Mock PDF Content'));

    console.log('✓ IPP binary encoding and decoding roundtrip verified successfully.');
    passed++;
  }

  // Test 2: PCLm Stream Packaging & Manual Duplex Math
  console.log('\n[Test 2] Testing PCLm packaging and manual duplex page calculations...');
  {
    const pclmStream = await PclmGenerator.preparePclmStream(dummyPdf, {
      colorMode: 'color',
      paperSize: 'A4',
    });

    const header = pclmStream.subarray(0, 50).toString('utf8');
    assert(header.includes('%PDF-1.7\n%PCLm-1.0'), 'Header must contain PCLm/PDF signature');

    // Manual Duplex Batching
    const batches5 = PclmGenerator.generateManualDuplexBatches(5);
    assert.deepStrictEqual(batches5.pass1OddPages, [1, 3, 5], '5-page doc odd pass should be [1, 3, 5]');
    assert.deepStrictEqual(batches5.pass2EvenPages, [2, 4], '5-page doc even pass should be [2, 4]');

    const batches6 = PclmGenerator.generateManualDuplexBatches(6);
    assert.deepStrictEqual(batches6.pass1OddPages, [1, 3, 5], '6-page doc odd pass should be [1, 3, 5]');
    assert.deepStrictEqual(batches6.pass2EvenPages, [2, 4, 6], '6-page doc even pass should be [2, 4, 6]');

    console.log('✓ PCLm raster encapsulation and manual duplex page sequences verified.');
    passed++;
  }

  // Test 3: HP Smart Tank 580 Hardware Capabilities
  console.log('\n[Test 3] Testing HP Smart Tank 580 adapter hardware profile...');
  {
    const adapter = new HpSmartTank580Adapter();
    assert.strictEqual(adapter.modelName, 'HP Smart Tank 580 All-in-One Printer');

    const caps = adapter.getHardwareCapabilities();
    assert.strictEqual(caps.supports_color, true);
    assert.strictEqual(caps.supports_duplex_manual, true);
    assert.strictEqual(caps.supports_duplex_auto, false);
    assert(caps.supported_pdls.includes('application/PCLm'));
    assert(caps.supported_pdls.includes('image/urf'));
    assert(caps.supported_pdls.includes('application/vnd.hp-PCL3GUI'));
    assert.strictEqual(caps.max_copies, 99);

    console.log('✓ Hardware capabilities strictly align with HP Smart Tank 580 specification.');
    passed++;
  }

  // Test 4: Mock IPP Server & Adapter Print Job Submission / Polling / Cancellation
  console.log('\n[Test 4] Testing IPP client transport with live mock IPP printer server...');
  {
    const mockPort = 6318;
    let receivedPrintJob = false;
    let receivedGetJobAttributes = false;
    let receivedCancelJob = false;

    const mockServer = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const fullBody = Buffer.concat(chunks);
        const reqMsg = IppProtocol.decode(fullBody);

        let responseMsg: IppMessage;

        if (reqMsg.operationIdOrStatus === IPP_OPERATIONS.PRINT_JOB) {
          receivedPrintJob = true;
          responseMsg = {
            operationIdOrStatus: IPP_STATUS_CODES.SUCCESSFUL_OK,
            requestId: reqMsg.requestId,
            operationAttributes: [
              { tag: IPP_TAGS.CHARSET, name: 'attributes-charset', value: 'utf-8' },
              { tag: IPP_TAGS.NATURAL_LANGUAGE, name: 'attributes-natural-language', value: 'en' },
            ],
            jobAttributes: [
              { tag: IPP_TAGS.INTEGER, name: 'job-id', value: 8842 },
              { tag: IPP_TAGS.KEYWORD, name: 'job-state', value: 'processing' },
            ],
          };
        } else if (reqMsg.operationIdOrStatus === IPP_OPERATIONS.GET_JOB_ATTRIBUTES) {
          receivedGetJobAttributes = true;
          responseMsg = {
            operationIdOrStatus: IPP_STATUS_CODES.SUCCESSFUL_OK,
            requestId: reqMsg.requestId,
            operationAttributes: [
              { tag: IPP_TAGS.CHARSET, name: 'attributes-charset', value: 'utf-8' },
              { tag: IPP_TAGS.NATURAL_LANGUAGE, name: 'attributes-natural-language', value: 'en' },
            ],
            jobAttributes: [
              { tag: IPP_TAGS.INTEGER, name: 'job-id', value: 8842 },
              { tag: IPP_TAGS.INTEGER, name: 'job-state', value: 5 }, // 5 = processing
              { tag: IPP_TAGS.INTEGER, name: 'job-impressions-completed', value: 3 },
            ],
          };
        } else if (reqMsg.operationIdOrStatus === IPP_OPERATIONS.CANCEL_JOB) {
          receivedCancelJob = true;
          responseMsg = {
            operationIdOrStatus: IPP_STATUS_CODES.SUCCESSFUL_OK,
            requestId: reqMsg.requestId,
            operationAttributes: [
              { tag: IPP_TAGS.CHARSET, name: 'attributes-charset', value: 'utf-8' },
              { tag: IPP_TAGS.NATURAL_LANGUAGE, name: 'attributes-natural-language', value: 'en' },
            ],
          };
        } else {
          responseMsg = {
            operationIdOrStatus: IPP_STATUS_CODES.CLIENT_ERROR_NOT_FOUND,
            requestId: reqMsg.requestId,
            operationAttributes: [
              { tag: IPP_TAGS.CHARSET, name: 'attributes-charset', value: 'utf-8' },
              { tag: IPP_TAGS.NATURAL_LANGUAGE, name: 'attributes-natural-language', value: 'en' },
            ],
          };
        }

        const encodedResp = IppProtocol.encode(responseMsg);
        res.writeHead(200, {
          'Content-Type': 'application/ipp',
          'Content-Length': encodedResp.length,
        });
        res.end(encodedResp);
      });
    });

    await new Promise<void>((resolve) => mockServer.listen(mockPort, '127.0.0.1', () => resolve()));

    try {
      const adapter = new HpSmartTank580Adapter();
      const mockPrinter: PrinterRecord = {
        id: 'mock-hp-580',
        name: 'HP Smart Tank 580 Mock',
        ip_address: '127.0.0.1',
        port: mockPort,
        model: 'HP Smart Tank 580 All-in-One',
        status: 'AVAILABLE',
        protocol: 'ipp',
        capabilities: {
          supports_color: true,
          supports_duplex_manual: true,
          supports_duplex_auto: false,
          supported_media_sizes: ['A4', 'Letter'],
          supported_pdls: ['PCLm', 'URF'],
          max_copies: 99,
        },
        is_default: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const testJob: PrintJobRecord = {
        id: 'test-job-ipp-1',
        document_id: 'doc-1',
        printer_id: mockPrinter.id,
        copies: 1,
        page_range: '1-3',
        paper_size: 'A4',
        orientation: 'portrait',
        color_mode: 'color',
        duplex_mode: 'simplex',
        priority: 1,
        queue_position: 1,
        status: 'PRINTING',
        last_confirmed_copy: 0,
        last_confirmed_page: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // 1. Submit Print Job
      const submitRes = await adapter.submitPrintJob(
        mockPrinter,
        testJob,
        dummyPdf
      );
      if (!submitRes.success) {
        console.error('submitRes error:', submitRes.errorMessage);
      }
      assert.strictEqual(submitRes.success, true);
      assert.strictEqual(submitRes.ippJobId, 8842);
      assert.strictEqual(submitRes.status, 'SUBMITTED');
      assert.strictEqual(receivedPrintJob, true, 'Mock server must receive Print-Job');

      // 2. Poll Job Attributes
      const attrRes = await adapter.getJobAttributes(mockPrinter, 8842);
      assert.strictEqual(attrRes.jobState, 'processing');
      assert.strictEqual(attrRes.impressionsCompleted, 3);
      assert.strictEqual(receivedGetJobAttributes, true, 'Mock server must receive Get-Job-Attributes');

      // 3. Cancel Job
      const cancelSuccess = await adapter.cancelPrintJob(mockPrinter, 8842);
      assert.strictEqual(cancelSuccess, true);
      assert.strictEqual(receivedCancelJob, true, 'Mock server must receive Cancel-Job');

      console.log('✓ IPP Print-Job submission, attribute polling, and job cancellation fully verified.');
      passed++;
    } finally {
      await new Promise<void>((resolve) => mockServer.close(() => resolve()));
    }
  }

  console.log(`\n======================================================`);
  console.log(`Phase 5 Test Suite Results: ${passed}/4 Tests Passed`);
  console.log(`======================================================\n`);
}

runTests().catch((err) => {
  console.error('Phase 5 Tests FAILED:', err);
  process.exit(1);
});
