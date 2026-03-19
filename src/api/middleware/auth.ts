import { Request, Response, NextFunction } from 'express';
import type { PlatformRole } from '../../types';

export interface SessionUser {
  userId: string;
  workspaceId: string;
  displayName: string;
  avatarUrl: string;
  platformRole: PlatformRole;
}

export interface AuthenticatedRequest extends Request {
  sessionUser: SessionUser;
}

/**
 * Helper to extract session user from request.
 * Use this instead of casting `req as AuthenticatedRequest` to avoid type overlap issues.
 */
export function getSessionUser(req: Request): SessionUser {
  return (req as any).sessionUser;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const session = (req as any).session;
  if (!session?.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  (req as any).sessionUser = session.user;
  next();
}
