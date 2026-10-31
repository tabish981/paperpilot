import path from 'path';
import fs from 'fs';

const BASE_DIR = path.resolve(process.env.STORAGE_PATH || path.join(__dirname, '../../storage'));

export const STORAGE_PATHS = {
  BASE: BASE_DIR,
  DOCUMENTS: path.join(BASE_DIR, 'documents'),
  PROCESSED: path.join(BASE_DIR, 'processed'),
  BACKUPS: path.join(BASE_DIR, 'backups'),
};

export function initializeStorageDirectories(): void {
  for (const dir of Object.values(STORAGE_PATHS)) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  console.log(`[Storage] Initialized storage paths under: ${BASE_DIR}`);
}
