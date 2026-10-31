import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';

// Enable verbose mode in development
const sqlite = sqlite3.verbose();

const DB_DIR = path.resolve(process.env.STORAGE_PATH || path.join(__dirname, '../../storage'));
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const DB_PATH = path.join(DB_DIR, 'paperpilot.sqlite');

export class Database {
  private static instance: Database;
  private db: sqlite3.Database;

  private constructor() {
    this.db = new sqlite.Database(DB_PATH, (err) => {
      if (err) {
        console.error('[DB] Failed to open SQLite database:', err.message);
      } else {
        console.log(`[DB] Connected to SQLite database at ${DB_PATH}`);
      }
    });

    // Configure PRAGMAs for concurrency and data integrity
    this.db.serialize(() => {
      this.db.run('PRAGMA journal_mode = WAL;');
      this.db.run('PRAGMA foreign_keys = ON;');
      this.db.run('PRAGMA synchronous = NORMAL;');
      this.db.run('PRAGMA busy_timeout = 5000;');
    });
  }

  public static getInstance(): Database {
    if (!Database.instance) {
      Database.instance = new Database();
    }
    return Database.instance;
  }

  public getRawDb(): sqlite3.Database {
    return this.db;
  }

  public run(sql: string, params: unknown[] = []): Promise<{ lastID: number; changes: number }> {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  public get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row as T | undefined);
      });
    });
  }

  public all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve((rows || []) as T[]);
      });
    });
  }

  public async exec(sql: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.exec(sql, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  public close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

export const db = Database.getInstance();
