import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { PDFDocument } from 'pdf-lib';
import { db } from '../database/connection';
import { validateFileSignature } from '../utils/fileValidation';
import { STORAGE_PATHS } from '../utils/storage';
import { DocumentProcessor } from '../services/documentProcessor';
import { printBrainService } from '../services/printBrainService';
import {
  DocumentRecord,
  RenameDocumentSchema,
  MergeDocumentsSchema,
  SplitDocumentSchema,
  ExtractPagesSchema,
  ImageToPdfSchema,
  CompressDocumentSchema,
} from '@paperpilot/shared';

export class DocumentController {
  public static async uploadDocument(req: Request, res: Response): Promise<void> {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      const tempPath = req.file.path;
      const originalName = req.file.originalname;

      // 1. Inspect actual binary magic bytes & SHA-256
      const validation = await validateFileSignature(tempPath);
      if (!validation.isValid || !validation.detectedType) {
        fs.unlinkSync(tempPath);
        res.status(400).json({
          error: 'File signature verification failed. Only genuine PDF, DOCX, and JPG/PNG are allowed.',
          details: validation.error,
        });
        return;
      }

      // 2. Duplicate Detection via SHA-256
      const existingDoc = await db.get<DocumentRecord>(
        'SELECT * FROM documents WHERE sha256_hash = ?',
        [validation.sha256]
      );

      if (existingDoc) {
        fs.unlinkSync(tempPath);
        res.status(200).json({
          message: 'Document already exists (SHA-256 matched). Reusing existing file reference.',
          document: existingDoc,
          isDuplicate: true,
        });
        return;
      }

      // 3. Page Count Inspection
      let pageCount = 1;
      if (validation.detectedType === 'application/pdf') {
        try {
          const pdfBytes = fs.readFileSync(tempPath);
          const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
          pageCount = pdfDoc.getPageCount();
        } catch (pdfErr) {
          console.warn('[DocController] Could not read PDF page count:', pdfErr);
        }
      } else if (validation.detectedType.startsWith('image/')) {
        pageCount = 1;
      } else if (validation.detectedType.includes('wordprocessingml')) {
        // For DOCX, estimate page count from file size or basic stream count
        pageCount = Math.max(1, Math.ceil(req.file.size / (15 * 1024)));
      }

      // 4. Move to permanent storage
      const documentId = uuidv4();
      const extension = path.extname(originalName) || '.bin';
      const storedFilename = `${documentId}${extension}`;
      const finalPath = path.join(STORAGE_PATHS.DOCUMENTS, storedFilename);

      fs.renameSync(tempPath, finalPath);

      // 5. Insert Record
      await db.run(
        `INSERT INTO documents (
          id, original_name, stored_filename, file_path, file_size, mime_type, sha256_hash,
          page_count, is_processed, processing_type
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'ORIGINAL')`,
        [
          documentId,
          originalName,
          storedFilename,
          finalPath,
          req.file.size,
          validation.detectedType,
          validation.sha256,
          pageCount,
        ]
      );

      let finalDoc = await db.get<DocumentRecord>(
        'SELECT * FROM documents WHERE id = ?',
        [documentId]
      );

      // 6. PrintBrain Smart Pipeline Preprocessing
      const preprocessing = await printBrainService.preprocessUploadedDocument(documentId);
      if (preprocessing.wasProcessed && preprocessing.derivedDocId) {
        const derived = await db.get<DocumentRecord>(
          'SELECT * FROM documents WHERE id = ?',
          [preprocessing.derivedDocId]
        );
        if (derived) {
          finalDoc = derived;
        }
      }

      res.status(201).json({
        message: 'Document uploaded and indexed successfully.',
        document: finalDoc,
        preprocessed: preprocessing,
        isDuplicate: false,
      });
    } catch (err: unknown) {
      console.error('[DocController] Upload error:', err);
      const msg = err instanceof Error ? err.message : 'Unknown server error';
      res.status(500).json({ error: 'Failed to process document upload', details: msg });
    }
  }

  public static async listDocuments(req: Request, res: Response): Promise<void> {
    try {
      const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
      const filter = typeof req.query.filter === 'string' ? req.query.filter.trim().toLowerCase() : 'all';
      const sortBy = typeof req.query.sortBy === 'string' ? req.query.sortBy : 'created_at';
      const sortOrder = req.query.sortOrder === 'asc' ? 'ASC' : 'DESC';

      let sql = 'SELECT * FROM documents WHERE 1=1';
      const params: unknown[] = [];

      if (search) {
        sql += ' AND original_name LIKE ?';
        params.push(`%${search}%`);
      }

      if (filter === 'pdf') {
        sql += " AND mime_type = 'application/pdf'";
      } else if (filter === 'image') {
        sql += " AND mime_type LIKE 'image/%'";
      } else if (filter === 'docx') {
        sql += " AND mime_type LIKE '%wordprocessingml%'";
      } else if (filter === 'processed') {
        sql += ' AND is_processed = 1';
      }

      // Whitelist sort fields to prevent SQL injection
      const allowedSortFields = ['created_at', 'original_name', 'file_size', 'page_count'];
      const safeSortField = allowedSortFields.includes(sortBy) ? sortBy : 'created_at';

      sql += ` ORDER BY ${safeSortField} ${sortOrder}`;

      const documents = await db.all<DocumentRecord>(sql, params);
      res.status(200).json({ documents, count: documents.length });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: 'Failed to list documents', details: msg });
    }
  }

  public static async getDocument(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const document = await db.get<DocumentRecord>('SELECT * FROM documents WHERE id = ?', [id]);

      if (!document) {
        res.status(404).json({ error: 'Document not found' });
        return;
      }

      if (req.query.download === 'true') {
        if (!fs.existsSync(document.file_path)) {
          res.status(404).json({ error: 'Physical document file missing on disk' });
          return;
        }
        res.download(document.file_path, document.original_name);
        return;
      }

      res.status(200).json({ document });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: 'Failed to get document', details: msg });
    }
  }

  public static async renameDocument(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const parsed = RenameDocumentSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid name provided', details: parsed.error.format() });
        return;
      }

      const existing = await db.get<DocumentRecord>('SELECT id FROM documents WHERE id = ?', [id]);
      if (!existing) {
        res.status(404).json({ error: 'Document not found' });
        return;
      }

      await db.run(
        "UPDATE documents SET original_name = ?, updated_at = datetime('now') WHERE id = ?",
        [parsed.data.new_name, id]
      );

      const updated = await db.get<DocumentRecord>('SELECT * FROM documents WHERE id = ?', [id]);
      res.status(200).json({ message: 'Document renamed successfully', document: updated });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: 'Failed to rename document', details: msg });
    }
  }

  public static async deleteDocument(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const document = await db.get<DocumentRecord>('SELECT * FROM documents WHERE id = ?', [id]);

      if (!document) {
        res.status(404).json({ error: 'Document not found' });
        return;
      }

      // Safe filesystem unlink
      if (fs.existsSync(document.file_path)) {
        try {
          fs.unlinkSync(document.file_path);
        } catch (unlinkErr) {
          console.warn('[DocController] Failed to unlink physical file:', unlinkErr);
        }
      }

      await db.run('DELETE FROM documents WHERE id = ?', [id]);
      res.status(200).json({ message: 'Document deleted successfully', id });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: 'Failed to delete document', details: msg });
    }
  }

  public static async mergeDocuments(req: Request, res: Response): Promise<void> {
    try {
      const parsed = MergeDocumentsSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid merge parameters', details: parsed.error.format() });
        return;
      }

      const mergedDoc = await DocumentProcessor.mergePdfs(
        parsed.data.documentIds,
        parsed.data.outputName
      );

      res.status(201).json({
        message: 'Documents merged successfully',
        document: mergedDoc,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: 'Failed to merge documents', details: msg });
    }
  }

  public static async splitDocument(req: Request, res: Response): Promise<void> {
    try {
      const parsed = SplitDocumentSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid split parameters', details: parsed.error.format() });
        return;
      }

      const slices = await DocumentProcessor.splitPdf(
        parsed.data.documentId,
        parsed.data.pageRanges
      );

      res.status(201).json({
        message: `Document split into ${slices.length} parts successfully`,
        documents: slices,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: 'Failed to split document', details: msg });
    }
  }

  public static async extractPages(req: Request, res: Response): Promise<void> {
    try {
      const parsed = ExtractPagesSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid extraction parameters', details: parsed.error.format() });
        return;
      }

      const extracted = await DocumentProcessor.extractPages(
        parsed.data.documentId,
        parsed.data.pageRange,
        parsed.data.outputName
      );

      res.status(201).json({
        message: 'Pages extracted successfully',
        document: extracted,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: 'Failed to extract pages', details: msg });
    }
  }

  public static async convertImageToPdf(req: Request, res: Response): Promise<void> {
    try {
      const parsed = ImageToPdfSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid image-to-PDF parameters', details: parsed.error.format() });
        return;
      }

      const pdfDoc = await DocumentProcessor.convertImagesToPdf(
        parsed.data.documentIds,
        parsed.data.outputName,
        parsed.data.pageSize
      );

      res.status(201).json({
        message: 'Image converted to print-ready PDF successfully',
        document: pdfDoc,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: 'Failed to convert image to PDF', details: msg });
    }
  }

  public static async compressDocument(req: Request, res: Response): Promise<void> {
    try {
      const parsed = CompressDocumentSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid compression parameters', details: parsed.error.format() });
        return;
      }

      const result = await DocumentProcessor.compressPdf(parsed.data.documentId);

      res.status(201).json({
        message: `Document compressed successfully (${result.percentSaved}% size reduction)`,
        result,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: 'Failed to compress document', details: msg });
    }
  }
}
