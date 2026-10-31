import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { PDFDocument } from 'pdf-lib';
import { db } from '../database/connection';
import { validateFileSignature } from '../utils/fileValidation';
import { STORAGE_PATHS } from '../utils/storage';
import { DocumentRecord, ProcessingType } from '@paperpilot/shared';

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 20;

export class DocumentProcessor {
  /**
   * Parse arbitrary page ranges (e.g. "1, 3-5, 8") into a sorted, unique list of 0-based page indices.
   */
  public static parsePageRange(rangeStr: string, totalPages: number): number[] {
    const indices = new Set<number>();
    const parts = rangeStr.split(',').map((p) => p.trim()).filter(Boolean);

    for (const part of parts) {
      if (part.includes('-')) {
        const [startStr, endStr] = part.split('-').map((s) => s.trim());
        const start = Math.max(1, parseInt(startStr, 10));
        const end = Math.min(totalPages, parseInt(endStr, 10));
        for (let i = start; i <= end; i++) {
          indices.add(i - 1);
        }
      } else {
        const pageNum = parseInt(part, 10);
        if (pageNum >= 1 && pageNum <= totalPages) {
          indices.add(pageNum - 1);
        }
      }
    }

    return Array.from(indices).sort((a, b) => a - b);
  }

  /**
   * Helper to safely save processed documents with SHA-256 deduplication.
   */
  private static async saveProcessedDocument(
    finalPath: string,
    fileBytes: Uint8Array,
    originalName: string,
    pageCount: number,
    processingType: ProcessingType,
    originalDocId: string
  ): Promise<DocumentRecord> {
    const validation = await validateFileSignature(finalPath);

    // Deduplication check: if file already exists with same SHA-256, reuse record
    const existing = await db.get<DocumentRecord>(
      'SELECT * FROM documents WHERE sha256_hash = ?',
      [validation.sha256]
    );

    if (existing) {
      if (fs.existsSync(finalPath) && path.resolve(finalPath) !== path.resolve(existing.file_path)) {
        try {
          fs.unlinkSync(finalPath);
        } catch {}
      }
      return existing;
    }

    const docId = path.parse(finalPath).name.replace(/^proc_/, '');
    const storedFilename = path.basename(finalPath);

    await db.run(
      `INSERT INTO documents (
        id, original_name, stored_filename, file_path, file_size, mime_type, sha256_hash,
        page_count, is_processed, original_doc_id, processing_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [
        docId,
        originalName,
        storedFilename,
        finalPath,
        fileBytes.length,
        validation.detectedType || 'application/pdf',
        validation.sha256,
        pageCount,
        originalDocId,
        processingType,
      ]
    );

    const created = await db.get<DocumentRecord>('SELECT * FROM documents WHERE id = ?', [docId]);
    if (!created) throw new Error('Failed to retrieve newly saved document');
    return created;
  }

  /**
   * Merge multiple PDFs into a single continuous PDF document.
   */
  public static async mergePdfs(
    documentIds: string[],
    outputName?: string
  ): Promise<DocumentRecord> {
    const mergedPdf = await PDFDocument.create();
    const sourceDocs: DocumentRecord[] = [];

    for (const id of documentIds) {
      const doc = await db.get<DocumentRecord>('SELECT * FROM documents WHERE id = ?', [id]);
      if (!doc || !fs.existsSync(doc.file_path)) {
        throw new Error(`Document with ID ${id} not found or missing from disk`);
      }
      if (doc.mime_type !== 'application/pdf') {
        throw new Error(`Document "${doc.original_name}" is not a PDF (Type: ${doc.mime_type})`);
      }
      sourceDocs.push(doc);

      const bytes = fs.readFileSync(doc.file_path);
      const srcPdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const copiedPages = await mergedPdf.copyPages(srcPdf, srcPdf.getPageIndices());
      copiedPages.forEach((page) => mergedPdf.addPage(page));
    }

    const mergedBytes = await mergedPdf.save();
    const newId = uuidv4();
    const finalName = outputName || `merged_${Date.now()}.pdf`;
    const storedFilename = `proc_${newId}.pdf`;
    const finalPath = path.join(STORAGE_PATHS.PROCESSED, storedFilename);

    fs.writeFileSync(finalPath, mergedBytes);

    return DocumentProcessor.saveProcessedDocument(
      finalPath,
      mergedBytes,
      finalName,
      mergedPdf.getPageCount(),
      'MERGED',
      sourceDocs[0].id
    );
  }

  /**
   * Split a PDF into discrete slices corresponding to user-specified page ranges.
   */
  public static async splitPdf(
    documentId: string,
    pageRanges: string[]
  ): Promise<DocumentRecord[]> {
    const doc = await db.get<DocumentRecord>('SELECT * FROM documents WHERE id = ?', [documentId]);
    if (!doc || !fs.existsSync(doc.file_path)) {
      throw new Error(`Source document not found`);
    }

    const srcBytes = fs.readFileSync(doc.file_path);
    const srcPdf = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
    const totalPages = srcPdf.getPageCount();

    const results: DocumentRecord[] = [];

    for (let i = 0; i < pageRanges.length; i++) {
      const range = pageRanges[i];
      const pageIndices = DocumentProcessor.parsePageRange(range, totalPages);
      if (pageIndices.length === 0) continue;

      const subPdf = await PDFDocument.create();
      const copiedPages = await subPdf.copyPages(srcPdf, pageIndices);
      copiedPages.forEach((p) => subPdf.addPage(p));

      const subBytes = await subPdf.save();
      const subId = uuidv4();
      const subStoredName = `proc_${subId}.pdf`;
      const subPath = path.join(STORAGE_PATHS.PROCESSED, subStoredName);

      fs.writeFileSync(subPath, subBytes);

      const parsedBase = path.parse(doc.original_name).name;
      const subName = `${parsedBase}_part${i + 1}_pages_${range.replace(/\s+/g, '')}.pdf`;

      const saved = await DocumentProcessor.saveProcessedDocument(
        subPath,
        subBytes,
        subName,
        copiedPages.length,
        'SPLIT',
        doc.id
      );

      results.push(saved);
    }

    return results;
  }

  /**
   * Extract a specific page subset into a standalone PDF.
   */
  public static async extractPages(
    documentId: string,
    pageRange: string,
    outputName?: string
  ): Promise<DocumentRecord> {
    const doc = await db.get<DocumentRecord>('SELECT * FROM documents WHERE id = ?', [documentId]);
    if (!doc || !fs.existsSync(doc.file_path)) {
      throw new Error('Document not found');
    }

    const srcBytes = fs.readFileSync(doc.file_path);
    const srcPdf = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
    const totalPages = srcPdf.getPageCount();
    const pageIndices = DocumentProcessor.parsePageRange(pageRange, totalPages);

    if (pageIndices.length === 0) {
      throw new Error(`Specified page range "${pageRange}" contains no valid pages (Document has ${totalPages} pages)`);
    }

    const extractPdf = await PDFDocument.create();
    const copiedPages = await extractPdf.copyPages(srcPdf, pageIndices);
    copiedPages.forEach((p) => extractPdf.addPage(p));

    const extractBytes = await extractPdf.save();
    const newId = uuidv4();
    const storedName = `proc_${newId}.pdf`;
    const finalPath = path.join(STORAGE_PATHS.PROCESSED, storedName);

    fs.writeFileSync(finalPath, extractBytes);

    const baseName = path.parse(doc.original_name).name;
    const finalName = outputName || `${baseName}_extracted.pdf`;

    return DocumentProcessor.saveProcessedDocument(
      finalPath,
      extractBytes,
      finalName,
      copiedPages.length,
      'EXTRACTED',
      doc.id
    );
  }

  /**
   * Convert one or more images (JPEG/PNG) into a print-ready A4 or fit-to-image PDF.
   */
  public static async convertImagesToPdf(
    imageDocIds: string[],
    outputName?: string,
    pageSize: 'A4' | 'fit_image' = 'A4'
  ): Promise<DocumentRecord> {
    const pdfDoc = await PDFDocument.create();
    const imageDocs: DocumentRecord[] = [];

    for (const id of imageDocIds) {
      const doc = await db.get<DocumentRecord>('SELECT * FROM documents WHERE id = ?', [id]);
      if (!doc || !fs.existsSync(doc.file_path)) {
        throw new Error(`Image document ${id} not found`);
      }
      imageDocs.push(doc);

      const imgBytes = fs.readFileSync(doc.file_path);
      let embeddedImage;

      if (doc.mime_type === 'image/jpeg') {
        embeddedImage = await pdfDoc.embedJpg(imgBytes);
      } else if (doc.mime_type === 'image/png') {
        embeddedImage = await pdfDoc.embedPng(imgBytes);
      } else {
        throw new Error(`Document "${doc.original_name}" is not a supported image format (MIME: ${doc.mime_type})`);
      }

      const imgWidth = embeddedImage.width;
      const imgHeight = embeddedImage.height;

      if (pageSize === 'fit_image') {
        const page = pdfDoc.addPage([imgWidth, imgHeight]);
        page.drawImage(embeddedImage, {
          x: 0,
          y: 0,
          width: imgWidth,
          height: imgHeight,
        });
      } else {
        const page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
        const availWidth = A4_WIDTH - MARGIN * 2;
        const availHeight = A4_HEIGHT - MARGIN * 2;

        const scale = Math.min(availWidth / imgWidth, availHeight / imgHeight);
        const drawWidth = imgWidth * scale;
        const drawHeight = imgHeight * scale;

        const posX = MARGIN + (availWidth - drawWidth) / 2;
        const posY = MARGIN + (availHeight - drawHeight) / 2;

        page.drawImage(embeddedImage, {
          x: posX,
          y: posY,
          width: drawWidth,
          height: drawHeight,
        });
      }
    }

    const pdfBytes = await pdfDoc.save();
    const newId = uuidv4();
    const storedName = `proc_${newId}.pdf`;
    const finalPath = path.join(STORAGE_PATHS.PROCESSED, storedName);

    fs.writeFileSync(finalPath, pdfBytes);

    const finalName = outputName || `image_conversion_${Date.now()}.pdf`;

    return DocumentProcessor.saveProcessedDocument(
      finalPath,
      pdfBytes,
      finalName,
      pdfDoc.getPageCount(),
      'IMAGE_TO_PDF',
      imageDocs[0].id
    );
  }

  /**
   * Compress PDF by packing objects into object streams and stripping redundant dictionaries.
   */
  public static async compressPdf(documentId: string): Promise<{
    document: DocumentRecord;
    originalSize: number;
    compressedSize: number;
    savedBytes: number;
    percentSaved: number;
  }> {
    const doc = await db.get<DocumentRecord>('SELECT * FROM documents WHERE id = ?', [documentId]);
    if (!doc || !fs.existsSync(doc.file_path)) {
      throw new Error('Document not found');
    }

    const srcBytes = fs.readFileSync(doc.file_path);
    const pdfDoc = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
    const compressedBytes = await pdfDoc.save({ useObjectStreams: true });

    const newId = uuidv4();
    const storedName = `proc_${newId}.pdf`;
    const finalPath = path.join(STORAGE_PATHS.PROCESSED, storedName);

    fs.writeFileSync(finalPath, compressedBytes);

    const baseName = path.parse(doc.original_name).name;
    const finalName = `compressed_${baseName}.pdf`;

    const savedDoc = await DocumentProcessor.saveProcessedDocument(
      finalPath,
      compressedBytes,
      finalName,
      pdfDoc.getPageCount(),
      'COMPRESSED',
      doc.id
    );

    const originalSize = doc.file_size;
    const compressedSize = compressedBytes.length;
    const savedBytes = Math.max(0, originalSize - compressedSize);
    const percentSaved = originalSize > 0 ? Math.round((savedBytes / originalSize) * 100) : 0;

    return {
      document: savedDoc,
      originalSize,
      compressedSize,
      savedBytes,
      percentSaved,
    };
  }
}
