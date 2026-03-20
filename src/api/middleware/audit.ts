import { Request, Response, NextFunction } from 'express';
import { getSessionUser } from './auth';
import { logAuditEvent } from '../../modules/audit';

export function auditMiddleware(req: Request, res: Response, next: NextFunction) {
  // Only audit mutating requests
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const originalEnd = res.end;
    res.end = function(...args: any[]) {
      try {
        const sessionUser = getSessionUser(req);
        if (sessionUser && res.statusCode < 400) {
          const action = `${req.method} ${req.baseUrl}${req.path}`.replace(/\/[a-f0-9-]{20,}/g, '/:id');
          logAuditEvent({
            workspaceId: sessionUser.workspaceId,
            actorUserId: sessionUser.userId,
            actorRole: sessionUser.platformRole || 'member',
            actionType: 'dashboard_api' as any,
            details: {
              action,
              path: `${req.baseUrl}${req.path}`,
              method: req.method,
            },
          });
        }
      } catch {
        // ignore auth errors
      }
      return originalEnd.apply(res, args);
    } as any;
  }
  next();
}
