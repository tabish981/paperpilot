import { Router } from 'express';
import { ServerController } from '../controllers/serverController';

const router = Router();

router.get('/health', ServerController.getHealth);
router.get('/status', ServerController.getStatus);
router.get('/storage', ServerController.getStorage);
router.get('/logs', ServerController.getLogs);
router.post('/backup', ServerController.createBackup);

export default router;
