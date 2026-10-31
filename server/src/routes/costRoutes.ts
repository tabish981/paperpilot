import { Router } from 'express';
import { CostController } from '../controllers/costController';

const router = Router();

router.post('/estimate', CostController.estimateCost);
router.get('/statistics', CostController.getStatistics);

export default router;
