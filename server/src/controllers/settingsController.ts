import { Request, Response } from 'express';
import { printBrainService } from '../services/printBrainService';
import { AutomationSettingsSchema } from '@paperpilot/shared';

export class SettingsController {
  public static async getAutomationRules(req: Request, res: Response): Promise<void> {
    try {
      const settings = await printBrainService.getSettings();
      res.status(200).json({ settings });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: 'Failed to retrieve automation rules', details: msg });
    }
  }

  public static async updateAutomationRules(req: Request, res: Response): Promise<void> {
    try {
      const parsed = AutomationSettingsSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid settings payload', details: parsed.error.format() });
        return;
      }

      const updated = await printBrainService.updateSettings(parsed.data);
      res.status(200).json({ message: 'Automation rules updated successfully', settings: updated });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: 'Failed to update automation rules', details: msg });
    }
  }

  public static async getBatteryGateStatus(req: Request, res: Response): Promise<void> {
    try {
      const batteryStatus = await printBrainService.evaluateBatteryGate();
      res.status(200).json({ battery: batteryStatus });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: 'Failed to evaluate battery gate', details: msg });
    }
  }

  public static async getJobRecoveryPlan(req: Request, res: Response): Promise<void> {
    try {
      const { jobId } = req.params;
      const plan = await printBrainService.calculateRecoveryPlan(jobId);
      res.status(200).json({ recoveryPlan: plan });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: 'Failed to calculate recovery plan', details: msg });
    }
  }
}
