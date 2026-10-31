import { db } from './connection';

export async function runMigrations(): Promise<void> {
  console.log('[Migrations] Initializing database schema...');

  const schemaSql = `
    -- 1. Documents catalog
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      original_name TEXT NOT NULL,
      stored_filename TEXT NOT NULL UNIQUE,
      file_path TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      mime_type TEXT NOT NULL,
      sha256_hash TEXT NOT NULL UNIQUE,
      page_count INTEGER NOT NULL DEFAULT 1,
      is_processed INTEGER NOT NULL DEFAULT 0,
      original_doc_id TEXT,
      processing_type TEXT NOT NULL DEFAULT 'ORIGINAL',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (original_doc_id) REFERENCES documents(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_documents_hash ON documents(sha256_hash);
    CREATE INDEX IF NOT EXISTS idx_documents_created ON documents(created_at);

    -- 2. Printers
    CREATE TABLE IF NOT EXISTS printers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      model TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 631,
      protocol TEXT NOT NULL DEFAULT 'ipp',
      is_default INTEGER NOT NULL DEFAULT 0,
      wifi_direct_ssid TEXT,
      bssid TEXT,
      capabilities TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'UNKNOWN',
      last_seen TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_printers_status ON printers(status);

    -- 3. Print Jobs Queue
    CREATE TABLE IF NOT EXISTS print_jobs (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      printer_id TEXT,
      copies INTEGER NOT NULL DEFAULT 1,
      page_range TEXT NOT NULL DEFAULT 'all',
      paper_size TEXT NOT NULL DEFAULT 'A4',
      orientation TEXT NOT NULL DEFAULT 'portrait',
      color_mode TEXT NOT NULL DEFAULT 'monochrome',
      duplex_mode TEXT NOT NULL DEFAULT 'simplex',
      priority INTEGER NOT NULL DEFAULT 50,
      queue_position INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'PENDING',
      error_message TEXT,
      last_confirmed_copy INTEGER NOT NULL DEFAULT 0,
      last_confirmed_page INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
      FOREIGN KEY (printer_id) REFERENCES printers(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_status_pos ON print_jobs(status, queue_position);
    CREATE INDEX IF NOT EXISTS idx_jobs_priority ON print_jobs(priority ASC, created_at ASC);

    -- 4. Print Job Checkpoints (Granular sheet-level recovery)
    CREATE TABLE IF NOT EXISTS print_job_checkpoints (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      copy_index INTEGER NOT NULL DEFAULT 1,
      completed_page INTEGER NOT NULL,
      total_pages INTEGER NOT NULL,
      verified_at TEXT NOT NULL DEFAULT (datetime('now')),
      is_verified_by_sensor INTEGER NOT NULL DEFAULT 0,
      user_confirmed INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      FOREIGN KEY (job_id) REFERENCES print_jobs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_checkpoints_job ON print_job_checkpoints(job_id, copy_index);

    -- 5. Print Job Events
    CREATE TABLE IF NOT EXISTS print_job_events (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      message TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (job_id) REFERENCES print_jobs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_events_job_created ON print_job_events(job_id, created_at);

    -- 6. Print Settings (Per profile or global)
    CREATE TABLE IF NOT EXISTS print_settings (
      id TEXT PRIMARY KEY,
      profile_name TEXT NOT NULL UNIQUE,
      default_copies INTEGER NOT NULL DEFAULT 1,
      default_paper_size TEXT NOT NULL DEFAULT 'A4',
      default_color_mode TEXT NOT NULL DEFAULT 'monochrome',
      default_duplex_mode TEXT NOT NULL DEFAULT 'simplex',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 7. Application Settings
    CREATE TABLE IF NOT EXISTS application_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 8. Notification Logs
    CREATE TABLE IF NOT EXISTS notification_logs (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      job_id TEXT,
      delivered INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_created ON notification_logs(created_at);

    -- 9. Server Logs
    CREATE TABLE IF NOT EXISTS server_logs (
      id TEXT PRIMARY KEY,
      level TEXT NOT NULL,
      source TEXT NOT NULL,
      message TEXT NOT NULL,
      context TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_server_logs_level ON server_logs(level, created_at);

    -- 10. Device Authorizations (For remote Tailscale / LAN access)
    CREATE TABLE IF NOT EXISTS device_authorizations (
      id TEXT PRIMARY KEY,
      device_name TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      api_token TEXT NOT NULL UNIQUE,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_device_token ON device_authorizations(api_token);
  `;

  await db.exec(schemaSql);

  // Migration patch: Ensure original_doc_id and processing_type exist for existing DBs
  try {
    const tableInfo = await db.all<{ name: string }>('PRAGMA table_info(documents)');
    const colNames = tableInfo.map((c) => c.name);
    if (!colNames.includes('original_doc_id')) {
      await db.run('ALTER TABLE documents ADD COLUMN original_doc_id TEXT REFERENCES documents(id) ON DELETE SET NULL');
    }
    if (!colNames.includes('processing_type')) {
      await db.run("ALTER TABLE documents ADD COLUMN processing_type TEXT NOT NULL DEFAULT 'ORIGINAL'");
    }
    await db.run('CREATE INDEX IF NOT EXISTS idx_documents_original ON documents(original_doc_id)');
  } catch (colErr) {
    console.warn('[Migrations] Column check notice:', colErr);
  }

  // Initialize default application settings if missing
  const existingSettings = await db.get<{ count: number }>(
    "SELECT count(*) as count FROM application_settings WHERE key = 'auto_print_enabled'"
  );

  if (!existingSettings || existingSettings.count === 0) {
    console.log('[Migrations] Seeding default application settings...');
    const defaultSettings = [
      ['auto_print_enabled', 'true'],
      ['battery_threshold_percent', '15'],
      ['max_retry_count', '3'],
      ['retry_delay_seconds', '5'],
      ['manual_recovery_required', 'true'],
      ['notification_level', 'all'],
      ['rate_per_page_bw_inr', '2.0'],
      ['rate_per_page_color_inr', '10.0'],
      ['paper_sheet_cost_inr', '0.5'],
    ];

    for (const [key, val] of defaultSettings) {
      await db.run(
        'INSERT OR REPLACE INTO application_settings (key, value, updated_at) VALUES (?, ?, datetime("now"))',
        [key, val]
      );
    }
  }

  // Pre-seed HP Smart Tank 580 profile if no printers exist
  const existingPrinters = await db.get<{ count: number }>('SELECT count(*) as count FROM printers');
  if (!existingPrinters || existingPrinters.count === 0) {
    console.log('[Migrations] Seeding default HP Smart Tank 580 profile...');
    const hp580Caps = JSON.stringify({
      supports_color: true,
      supports_duplex_manual: true,
      supports_duplex_auto: false,
      supported_media_sizes: ['A4', 'Letter', 'Legal', '4x6', '5x7'],
      supported_pdls: ['application/PCLm', 'image/urf', 'application/vnd.hp-PCL3GUI'],
      max_copies: 99,
      uri_supported: 'ipp://192.168.223.1:631/ipp/print',
      firmware_version: 'ST580_VER_2024',
    });

    await db.run(
      `INSERT INTO printers (
        id, name, model, ip_address, port, protocol, is_default, wifi_direct_ssid, capabilities, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'hp-smart-tank-580-default',
        'HP Smart Tank 580 (Wi-Fi Direct)',
        'HP Smart Tank 580 All-in-One Printer',
        '192.168.223.1',
        631,
        'ipp',
        1,
        'DIRECT-HP-SmartTank580',
        hp580Caps,
        'DISCONNECTED',
      ]
    );
  }

  console.log('[Migrations] Database migrations completed successfully.');
}
