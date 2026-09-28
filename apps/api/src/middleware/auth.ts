import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { SessionUser, UserRole } from '@proofchain/types';
import { env } from '../config.js';
import { forbidden, unauthorized } from '../errors.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: SessionUser;
  }
}

export function signToken(user: SessionUser): string {
  return jwt.sign(
    { sub: user.id, email: user.email, displayName: user.displayName, role: user.role },
    env.JWT_SECRET,
    { expiresIn: '12h' }
  );
}

function readUser(req: Request): SessionUser | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  try {
    const payload = jwt.verify(header.slice(7), env.JWT_SECRET) as jwt.JwtPayload;
    return {
      id: String(payload.sub),
      email: String(payload.email),
      displayName: String(payload.displayName ?? ''),
      role: payload.role as UserRole,
    };
  } catch {
    return null;
  }
}

/** Attach req.user when a valid token is present; never rejects. */
export function attachUser(req: Request, _res: Response, next: NextFunction) {
  const user = readUser(req);
  if (user) req.user = user;
  next();
}

/**
 * Require an authenticated APPLICATION user, optionally restricted to
 * roles. Application roles gate API operations only; on-chain ownership
 * is enforced separately by the smart contract itself.
 */
export function requireAuth(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = req.user ?? readUser(req);
    if (!user) return next(unauthorized());
    req.user = user;
    if (roles.length > 0 && !roles.includes(user.role)) {
      return next(
        forbidden(`This operation requires one of the roles: ${roles.join(', ')} (you are ${user.role})`)
      );
    }
    next();
  };
}

/** Roles allowed to register artifacts / create versions. */
export const WRITER_ROLES: UserRole[] = ['ADMIN', 'RESEARCHER', 'DEVELOPER'];
