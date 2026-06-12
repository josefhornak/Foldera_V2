import type { NextFunction, Request, Response } from 'express';
import { SignJWT, jwtVerify } from 'jose';

import env from '../config/env.js';
import { AppError, ErrorCodes } from '../utils/errors.js';

const JWT_ALG = 'HS256';
const JWT_EXPIRY = '7d';

const secret = new TextEncoder().encode(env.JWT_SECRET);

export interface AuthUser {
  userId: string;
  email: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthUser;
  }
}

export async function signAuthToken(user: AuthUser): Promise<string> {
  return new SignJWT({ email: user.email })
    .setProtectedHeader({ alg: JWT_ALG })
    .setSubject(user.userId)
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY)
    .sign(secret);
}

export async function verifyAuthToken(token: string): Promise<AuthUser> {
  const { payload } = await jwtVerify(token, secret, { algorithms: [JWT_ALG] });
  if (!payload.sub || typeof payload.email !== 'string') {
    throw new AppError(ErrorCodes.UNAUTHORIZED, 'Invalid token payload', 401);
  }
  return { userId: payload.sub, email: payload.email };
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new AppError(ErrorCodes.UNAUTHORIZED, 'Missing Authorization header', 401);
    }
    req.auth = await verifyAuthToken(header.slice('Bearer '.length));
    next();
  } catch (err) {
    next(
      err instanceof AppError ? err : new AppError(ErrorCodes.UNAUTHORIZED, 'Invalid or expired token', 401)
    );
  }
}
