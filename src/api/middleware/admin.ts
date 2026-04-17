import { Request, Response, NextFunction } from 'express';
import { getSessionUser } from './auth';

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const user = getSessionUser(req);
  // Admin = platform role superadmin/admin OR workspace membership role 'admin'
  // in the active workspace. Without the workspaceRole branch, anyone who
  // installed the app into a new Slack workspace would be locked out of
  // Settings / Access & Roles because their platform_roles row doesn't exist
  // and defaults to 'member'.
  const isAdmin = user.platformRole === 'superadmin'
    || user.platformRole === 'admin'
    || user.workspaceRole === 'admin';
  if (!isAdmin) {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}
