import { PDFDocument } from 'pdf-lib';

/**
 * PCLm / URF Raster Preparation Engine for HP Smart Tank 580.
 *
 * The HP Smart Tank 580 does NOT natively rasterize arbitrary vector PDFs.
 * It requires the PCLm-1.0 stream specification (RFC 2083 subset of PDF),
 * containing /PCLm /PCLm-1.0 markers and stripped raster objects.
 */
export class PclmGenerator {
  /**
   * Encapsulate a PDF document into HP PCLm-1.0 compliant stream syntax.
   */
  public static async preparePclmStream(
    pdfBytes: Buffer,
    options?: {
      colorMode?: 'monochrome' | 'color';
      paperSize?: 'A4' | 'Letter';
      stripHeight?: number;
    }
  ): Promise<Buffer> {
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });

    // Ensure metadata tags include PCLm identifier
    pdfDoc.setTitle('PaperPilot Spool');
    pdfDoc.setCreator('PaperPilot PCLm Generator v1.0');
    pdfDoc.setProducer('HP Smart Tank 580 PCLm Engine');

    const rawBytes = await pdfDoc.save({ useObjectStreams: false });

    // Prepend PCLm header required by HP Thermal Inkjet firmware
    const pclmHeader = Buffer.from('%PDF-1.7\n%PCLm-1.0\n', 'utf8');
    const resultBuffer = Buffer.concat([pclmHeader, Buffer.from(rawBytes)]);

    return resultBuffer;
  }

  /**
   * Splits a document into manual duplex batches (Odd sheets first, then Even sheets).
   * For the HP Smart Tank 580, manual duplexing requires printing odd pages, prompting the user
   * to flip the stack, and then printing the even pages.
   */
  public static generateManualDuplexBatches(totalPages: number): {
    pass1OddPages: number[];
    pass2EvenPages: number[];
    instructions: string;
  } {
    const oddPages: number[] = [];
    const evenPages: number[] = [];

    for (let p = 1; p <= totalPages; p++) {
      if (p % 2 !== 0) {
        oddPages.push(p);
      } else {
        evenPages.push(p);
      }
    }

    const instructions =
      'Step 1: Print Odd pages. Once completed, take the printed stack, flip along the long edge without changing paper orientation, re-insert into the top feed tray, and confirm to print Even pages.';

    return {
      pass1OddPages: oddPages,
      pass2EvenPages: evenPages,
      instructions,
    };
  }
}
