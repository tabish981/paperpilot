import { Router } from 'express';
import { QueueController } from '../controllers/queueController';

const router = Router();

router.post('/', QueueController.enqueueJob);
router.get('/', QueueController.listQueue);
router.post('/reorder', QueueController.reorderQueue);
router.post('/pause-all', QueueController.pauseAll);
router.post('/resume-all', QueueController.resumeAll);
router.post('/clear-completed', QueueController.clearCompleted);

router.get('/:id', QueueController.getJob);
router.patch('/:id', QueueController.updateJob);
router.delete('/:id', QueueController.deleteJob);
router.post('/:id/pause', QueueController.pauseJob);
router.post('/:id/resume', QueueController.resumeJob);
router.post('/:id/cancel', QueueController.cancelJob);
router.post('/:id/retry', QueueController.retryJob);
router.post('/:id/recover', QueueController.recoverJob);
router.post('/:id/confirm-duplex', QueueController.confirmDuplexStep);

export default router;
