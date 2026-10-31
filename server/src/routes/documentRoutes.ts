import { Router } from 'express';
import multer from 'multer';
import os from 'os';
import { DocumentController } from '../controllers/documentController';

const router = Router();
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB max
});

router.post('/upload', upload.single('file'), DocumentController.uploadDocument);
router.get('/', DocumentController.listDocuments);
router.get('/:id', DocumentController.getDocument);
router.patch('/:id', DocumentController.renameDocument);
router.delete('/:id', DocumentController.deleteDocument);
router.post('/merge', DocumentController.mergeDocuments);
router.post('/split', DocumentController.splitDocument);
router.post('/extract', DocumentController.extractPages);
router.post('/image-to-pdf', DocumentController.convertImageToPdf);
router.post('/compress', DocumentController.compressDocument);

export default router;
