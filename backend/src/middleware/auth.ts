import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { query } from '../config/database';
import { User, UserRole } from '../types';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: UserRole;
    companyId: string | null;
  };
}

export interface JwtPayload {
  userId: string;
  email: string;
  role: UserRole;
  companyId: string | null;
}

export async function authenticate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'No token provided',
      });
      return;
    }

    const token = authHeader.substring(7);

    try {
      const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;

      // Verify user still exists and is active
      const users = await query<User>(
        'SELECT id, email, role, company_id, is_active FROM users WHERE id = $1',
        [decoded.userId]
      );

      if (users.length === 0 || !users[0].is_active) {
        res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'User not found or inactive',
        });
        return;
      }

      req.user = {
        id: decoded.userId,
        email: decoded.email,
        role: decoded.role,
        companyId: decoded.companyId,
      };

      next();
    } catch (jwtError) {
      res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Invalid or expired token',
      });
      return;
    }
  } catch (error) {
    next(error);
  }
}

export function authorize(...allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Authentication required',
      });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'You do not have permission to perform this action',
      });
      return;
    }

    next();
  };
}

export function requireCompany(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.user?.companyId) {
    res.status(400).json({
      success: false,
      error: 'Bad Request',
      message: 'No company associated with this user',
    });
    return;
  }

  next();
}

export function generateToken(payload: JwtPayload): string {
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  });
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, config.jwt.secret) as JwtPayload;
  } catch {
    return null;
  }
}
