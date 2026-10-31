import { Request, Response } from 'express';
import { db } from '../database/connection';
import { CostEstimateSchema, CostEstimateResult } from '@paperpilot/shared';

export class CostController {
  public static async estimateCost(req: Request, res: Response): Promise<void> {
    try {
      const parsed = CostEstimateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.format() });
        return;
      }

      const { page_count, copies, color_mode, duplex_mode } = parsed.data;

      // Fetch user-configured rates from application_settings
      const bwRateRow = await db.get<{ value: string }>(
        "SELECT value FROM application_settings WHERE key = 'rate_per_page_bw_inr'"
      );
      const colorRateRow = await db.get<{ value: string }>(
        "SELECT value FROM application_settings WHERE key = 'rate_per_page_color_inr'"
      );
      const paperRateRow = await db.get<{ value: string }>(
        "SELECT value FROM application_settings WHERE key = 'paper_sheet_cost_inr'"
      );

      const bwRate = parseFloat(bwRateRow?.value || '2.0');
      const colorRate = parseFloat(colorRateRow?.value || '10.0');
      const paperSheetCost = parseFloat(paperRateRow?.value || '0.5');

      const totalImpressions = page_count * copies;
      const ratePerImpression = color_mode === 'color' ? colorRate : bwRate;
      const inkCost = totalImpressions * ratePerImpression;

      // In duplex, each physical sheet holds up to 2 impressions per copy
      const sheetsPerCopy = duplex_mode === 'manual_duplex' ? Math.ceil(page_count / 2) : page_count;
      const totalSheets = sheetsPerCopy * copies;
      const paperCost = totalSheets * paperSheetCost;

      const simplexSheets = page_count * copies;
      const sheetsSaved = duplex_mode === 'manual_duplex' ? simplexSheets - totalSheets : 0;
      const duplexSavings = sheetsSaved * paperSheetCost;

      const totalCost = inkCost + paperCost;

      const result: CostEstimateResult = {
        page_count,
        copies,
        total_impressions: totalImpressions,
        estimated_sheets: totalSheets,
        cost_per_impression_inr: ratePerImpression,
        ink_cost_inr: Math.round(inkCost * 100) / 100,
        paper_cost_inr: Math.round(paperCost * 100) / 100,
        duplex_savings_inr: Math.round(duplexSavings * 100) / 100,
        total_estimated_cost_inr: Math.round(totalCost * 100) / 100,
      };

      res.status(200).json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: 'Failed to calculate cost estimate', details: msg });
    }
  }

  public static async getStatistics(req: Request, res: Response): Promise<void> {
    try {
      const completedJobs = await db.get<{ count: number; total_copies: number }>(`
        SELECT 
          count(*) as count,
          COALESCE(SUM(copies), 0) as total_copies
        FROM print_jobs 
        WHERE status = 'COMPLETED'
      `);

      res.status(200).json({
        completed_jobs_count: completedJobs?.count || 0,
        total_copies_printed: completedJobs?.total_copies || 0,
        currency: 'INR',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(500).json({ error: 'Failed to retrieve cost statistics', details: msg });
    }
  }
}
