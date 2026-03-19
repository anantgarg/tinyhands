import { Request, Response, NextFunction } from 'express';
import { getSessionUser } from './auth';

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const user = getSessionUser(req);
  if (user.platformRole !== 'superadmin' && user.platformRole !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}
