import { Router } from 'express';
import { SettingsController } from '../controllers/settingsController';

const router = Router();

router.get('/automation', SettingsController.getAutomationRules);
router.patch('/automation', SettingsController.updateAutomationRules);
router.get('/battery', SettingsController.getBatteryGateStatus);
router.get('/recovery/:jobId', SettingsController.getJobRecoveryPlan);

export default router;
