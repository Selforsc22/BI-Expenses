import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;

  constructor(message: string, statusCode: number = 500) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  errors: Record<string, string[]>;

  constructor(message: string, errors: Record<string, string[]>) {
    super(message, 400);
    this.errors = errors;
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, 404);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super(message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Forbidden') {
    super(message, 403);
  }
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  console.error('Error:', err);

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    const errors: Record<string, string[]> = {};
    err.errors.forEach((e) => {
      const path = e.path.join('.');
      if (!errors[path]) {
        errors[path] = [];
      }
      errors[path].push(e.message);
    });

    res.status(400).json({
      success: false,
      error: 'Validation Error',
      message: 'Invalid request data',
      errors,
    });
    return;
  }

  // Handle custom validation errors
  if (err instanceof ValidationError) {
    res.status(err.statusCode).json({
      success: false,
      error: 'Validation Error',
      message: err.message,
      errors: err.errors,
    });
    return;
  }

  // Handle custom app errors
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: err.name,
      message: err.message,
    });
    return;
  }

  // Handle PostgreSQL errors
  if ((err as any).code) {
    const pgError = err as any;

    switch (pgError.code) {
      case '23505': // unique_violation
        res.status(409).json({
          success: false,
          error: 'Conflict',
          message: 'A record with this value already exists',
        });
        return;
      case '23503': // foreign_key_violation
        res.status(400).json({
          success: false,
          error: 'Bad Request',
          message: 'Referenced record does not exist',
        });
        return;
      case '23502': // not_null_violation
        res.status(400).json({
          success: false,
          error: 'Bad Request',
          message: `Required field missing: ${pgError.column}`,
        });
        return;
    }
  }

  // Default error response
  const statusCode = (err as any).statusCode || 500;
  const message = process.env.NODE_ENV === 'production'
    ? 'Internal Server Error'
    : err.message || 'Something went wrong';

  res.status(statusCode).json({
    success: false,
    error: 'Internal Server Error',
    message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
