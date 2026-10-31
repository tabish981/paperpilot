import { Router } from 'express';
import { PrinterController } from '../controllers/printerController';

const router = Router();

router.get('/', PrinterController.listPrinters);
router.post('/', PrinterController.registerPrinter);
router.delete('/:id', PrinterController.deletePrinter);
router.post('/discover', PrinterController.discoverPrinters);
router.get('/:id/status', PrinterController.getPrinterStatus);
router.post('/:id/test', PrinterController.testPrinter);
router.post('/network-event', PrinterController.handleNetworkEvent);

export default router;
