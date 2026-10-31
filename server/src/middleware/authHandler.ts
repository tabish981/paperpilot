import { Request, Response, NextFunction } from 'express';
import { db } from '../database/connection';

export async function authHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  const remoteIp = req.socket.remoteAddress || '';

  // Localhost (loopback IPv4/IPv6) from same Android device is trusted by default
  const isLocalhost =
    remoteIp === '127.0.0.1' ||
    remoteIp === '::1' ||
    remoteIp === '::ffff:127.0.0.1' ||
    remoteIp === 'localhost';

  if (isLocalhost) {
    return next();
  }

  // Allow healthcheck and status without auth
  if (req.path === '/api/server/health' || req.path === '/api/server/status') {
    return next();
  }

  // Remote access requires Authorization header: Bearer <api_token>
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'Unauthorized: Remote access requires a valid Bearer token.',
      remote_ip: remoteIp,
    });
    return;
  }

  const token = authHeader.split(' ')[1];
  try {
    const authRecord = await db.get<{ id: string; device_name: string }>(
      'SELECT id, device_name FROM device_authorizations WHERE api_token = ? AND is_active = 1',
      [token]
    );

    if (!authRecord) {
      res.status(403).json({ error: 'Forbidden: Invalid or revoked access token.' });
      return;
    }

    await db.run(
      "UPDATE device_authorizations SET last_used_at = datetime('now') WHERE id = ?",
      [authRecord.id]
    );

    next();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Database error';
    res.status(500).json({ error: 'Auth verification failed', details: msg });
  }
}
