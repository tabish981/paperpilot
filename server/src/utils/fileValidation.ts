import fs from 'fs';
import crypto from 'crypto';
import { FILE_SIGNATURES } from '@paperpilot/shared';

export interface FileValidationResult {
  isValid: boolean;
  detectedType?: string;
  sha256: string;
  error?: string;
}

/**
 * Validates actual binary contents against file magic numbers / signatures.
 * Never trusts client file extensions or Content-Type headers.
 */
export async function validateFileSignature(filePath: string): Promise<FileValidationResult> {
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.alloc(16);

  try {
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buffer, 0, 16, 0);
    fs.closeSync(fd);

    // Compute full SHA-256
    const fileStream = fs.createReadStream(filePath);
    for await (const chunk of fileStream) {
      hash.update(chunk);
    }
    const sha256 = hash.digest('hex');

    // Check PDF (%PDF)
    if (
      buffer[0] === FILE_SIGNATURES.PDF[0] &&
      buffer[1] === FILE_SIGNATURES.PDF[1] &&
      buffer[2] === FILE_SIGNATURES.PDF[2] &&
      buffer[3] === FILE_SIGNATURES.PDF[3]
    ) {
      return { isValid: true, detectedType: 'application/pdf', sha256 };
    }

    // Check JPEG (FF D8 FF)
    if (
      buffer[0] === FILE_SIGNATURES.JPEG[0] &&
      buffer[1] === FILE_SIGNATURES.JPEG[1] &&
      buffer[2] === FILE_SIGNATURES.JPEG[2]
    ) {
      return { isValid: true, detectedType: 'image/jpeg', sha256 };
    }

    // Check PNG (89 50 4E 47 0D 0A 1A 0A)
    const isPng = FILE_SIGNATURES.PNG.every((byte, index) => buffer[index] === byte);
    if (isPng) {
      return { isValid: true, detectedType: 'image/png', sha256 };
    }

    // Check DOCX / ZIP (PK\x03\x04)
    if (
      buffer[0] === FILE_SIGNATURES.DOCX_ZIP[0] &&
      buffer[1] === FILE_SIGNATURES.DOCX_ZIP[1] &&
      buffer[2] === FILE_SIGNATURES.DOCX_ZIP[2] &&
      buffer[3] === FILE_SIGNATURES.DOCX_ZIP[3]
    ) {
      return {
        isValid: true,
        detectedType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        sha256,
      };
    }

    return {
      isValid: false,
      sha256,
      error: 'Unsupported file signature or corrupted file payload',
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown validation error';
    return {
      isValid: false,
      sha256: '',
      error: `File signature validation failed: ${message}`,
    };
  }
}
