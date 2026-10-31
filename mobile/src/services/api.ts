import axios, { AxiosInstance } from 'axios';
import {
  DocumentRecord,
  PrintJobRecord,
  PrinterRecord,
  ServerHealthResponse,
  CostEstimateResult,
} from '@paperpilot/shared';

export class ApiService {
  private static instance: ApiService;
  private client: AxiosInstance;
  private serverUrl: string = 'http://127.0.0.1:5000';
  private authToken: string | null = null;

  private constructor() {
    this.client = axios.create({
      baseURL: `${this.serverUrl}/api`,
      timeout: 10000,
    });
  }

  public static getInstance(): ApiService {
    if (!ApiService.instance) {
      ApiService.instance = new ApiService();
    }
    return ApiService.instance;
  }

  public setServerUrl(url: string): void {
    this.serverUrl = url;
    this.client.defaults.baseURL = `${url}/api`;
  }

  public getServerUrl(): string {
    return this.serverUrl;
  }

  public setAuthToken(token: string | null): void {
    this.authToken = token;
    if (token) {
      this.client.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    } else {
      delete this.client.defaults.headers.common['Authorization'];
    }
  }

  // --- Documents API ---
  public async getDocuments(params?: {
    search?: string;
    filter?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }): Promise<{ documents: DocumentRecord[]; count: number }> {
    const res = await this.client.get('/documents', { params });
    return res.data;
  }

  public async getDocument(id: string): Promise<{ document: DocumentRecord }> {
    const res = await this.client.get(`/documents/${id}`);
    return res.data;
  }

  public async renameDocument(id: string, new_name: string): Promise<{ document: DocumentRecord }> {
    const res = await this.client.patch(`/documents/${id}`, { new_name });
    return res.data;
  }

  public async deleteDocument(id: string): Promise<void> {
    await this.client.delete(`/documents/${id}`);
  }

  public async uploadDocument(
    formData: FormData,
    onProgress?: (percentage: number) => void
  ): Promise<{ document: DocumentRecord; isDuplicate: boolean; message: string }> {
    const res = await this.client.post('/documents/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (progressEvent) => {
        if (progressEvent.total && onProgress) {
          const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          onProgress(percent);
        }
      },
    });
    return res.data;
  }

  public async mergeDocuments(
    documentIds: string[],
    outputName?: string
  ): Promise<{ message: string; document: DocumentRecord }> {
    const res = await this.client.post('/documents/merge', { documentIds, outputName });
    return res.data;
  }

  public async splitDocument(
    documentId: string,
    pageRanges: string[]
  ): Promise<{ message: string; documents: DocumentRecord[] }> {
    const res = await this.client.post('/documents/split', { documentId, pageRanges });
    return res.data;
  }

  public async extractPages(
    documentId: string,
    pageRange: string,
    outputName?: string
  ): Promise<{ message: string; document: DocumentRecord }> {
    const res = await this.client.post('/documents/extract', { documentId, pageRange, outputName });
    return res.data;
  }

  public async convertImageToPdf(
    documentIds: string[],
    outputName?: string,
    pageSize: 'A4' | 'fit_image' = 'A4'
  ): Promise<{ message: string; document: DocumentRecord }> {
    const res = await this.client.post('/documents/image-to-pdf', { documentIds, outputName, pageSize });
    return res.data;
  }

  public async compressDocument(
    documentId: string
  ): Promise<{ message: string; result: any }> {
    const res = await this.client.post('/documents/compress', { documentId });
    return res.data;
  }

  // --- Queue API ---
  public async getQueue(status?: string): Promise<{
    queue: PrintJobRecord[];
    count: number;
    isQueuePaused: boolean;
    activeJobId: string | null;
  }> {
    const res = await this.client.get('/queue', { params: { status } });
    return res.data;
  }

  public async getJob(id: string): Promise<{ job: PrintJobRecord }> {
    const res = await this.client.get(`/queue/${id}`);
    return res.data;
  }

  public async enqueueJob(payload: {
    document_id: string;
    printer_id?: string | null;
    copies?: number;
    page_range?: string;
    paper_size?: string;
    orientation?: string;
    color_mode?: string;
    duplex_mode?: string;
    priority?: number;
  }): Promise<{ message: string; job: PrintJobRecord }> {
    const res = await this.client.post('/queue', payload);
    return res.data;
  }

  public async pauseJob(id: string): Promise<void> {
    await this.client.post(`/queue/${id}/pause`);
  }

  public async resumeJob(id: string): Promise<void> {
    await this.client.post(`/queue/${id}/resume`);
  }

  public async cancelJob(id: string): Promise<void> {
    await this.client.post(`/queue/${id}/cancel`);
  }

  public async retryJob(id: string): Promise<{ job: PrintJobRecord }> {
    const res = await this.client.post(`/queue/${id}/retry`);
    return res.data;
  }

  public async reorderQueue(jobIdsInOrder: string[]): Promise<{ queue: PrintJobRecord[] }> {
    const res = await this.client.post('/queue/reorder', { jobIdsInOrder });
    return res.data;
  }

  public async pauseAllQueue(): Promise<{ isQueuePaused: boolean }> {
    const res = await this.client.post('/queue/pause-all');
    return res.data;
  }

  public async resumeAllQueue(): Promise<{ isQueuePaused: boolean }> {
    const res = await this.client.post('/queue/resume-all');
    return res.data;
  }

  public async clearCompletedQueue(): Promise<{ clearedCount: number }> {
    const res = await this.client.post('/queue/clear-completed');
    return res.data;
  }

  public async recoverJob(
    id: string,
    data: { confirmed_completed_page: number; resume_from_page: number; resume_from_copy: number }
  ): Promise<{ message: string; job: PrintJobRecord }> {
    const res = await this.client.post(`/queue/${id}/recover`, data);
    return res.data;
  }

  public async confirmDuplexStep(id: string): Promise<{ message: string; job: PrintJobRecord }> {
    const res = await this.client.post(`/queue/${id}/confirm-duplex`);
    return res.data;
  }

  // --- Settings API ---
  public async getAutomationSettings(): Promise<{
    auto_print_when_reachable: boolean;
    battery_cutoff_percent: number;
    bw_rate: number;
    color_rate: number;
    paper_rate: number;
    smart_compress_threshold_mb: number;
    smart_image_to_pdf: boolean;
  }> {
    const res = await this.client.get('/settings/automation');
    return res.data;
  }

  public async saveAutomationSettings(settings: {
    auto_print_when_reachable?: boolean;
    battery_cutoff_percent?: number;
    bw_rate?: number;
    color_rate?: number;
    paper_rate?: number;
    smart_compress_threshold_mb?: number;
    smart_image_to_pdf?: boolean;
  }): Promise<{ message: string }> {
    const res = await this.client.put('/settings/automation', settings);
    return res.data;
  }

  public async getRecoveryPlan(id: string): Promise<{
    job_id: string;
    status: string;
    total_pages: number;
    total_copies: number;
    last_successful_page: number;
    last_successful_copy: number;
    pages_printed: number;
    pages_remaining: number;
    resume_suggestion: { resume_from_page: number; resume_from_copy: number };
  }> {
    const res = await this.client.get(`/settings/recovery-plan/${id}`);
    return res.data;
  }

  // --- Printers API ---
  public async getPrinters(): Promise<{ printers: PrinterRecord[]; count: number }> {
    const res = await this.client.get('/printers');
    return res.data;
  }

  public async discoverPrinters(gatewayIp?: string): Promise<{
    message: string;
    discovered: Array<{
      ip: string;
      port: number;
      protocol: string;
      model: string;
      reachable: boolean;
      latencyMs: number;
    }>;
  }> {
    const res = await this.client.post('/printers/discover', { gatewayIp });
    return res.data;
  }

  public async getPrinterStatus(id: string): Promise<{
    id: string;
    name: string;
    ip_address: string;
    port: number;
    status: string;
    latencyMs: number;
    reachable: boolean;
  }> {
    const res = await this.client.get(`/printers/${id}/status`);
    return res.data;
  }

  public async testPrinter(id: string): Promise<{ success: boolean; message: string }> {
    const res = await this.client.post(`/printers/${id}/test`);
    return res.data;
  }

  // --- Server API ---
  public async getServerHealth(): Promise<ServerHealthResponse> {
    const res = await this.client.get('/server/health');
    return res.data;
  }

  public async createBackup(): Promise<{ message: string; backup_file: string }> {
    const res = await this.client.post('/server/backup');
    return res.data;
  }

  // --- Cost API ---
  public async estimateCost(params: {
    page_count: number;
    copies: number;
    color_mode: string;
    duplex_mode: string;
  }): Promise<CostEstimateResult> {
    const res = await this.client.post('/cost/estimate', params);
    return res.data;
  }
}

export const api = ApiService.getInstance();
