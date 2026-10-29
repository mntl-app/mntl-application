import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { Request, Response } from 'express';

// Each MNTL profile created in a browser gets its own signed cookie, so several
// profiles can be used side by side in different tabs. Requests name the profile
// they act for in the PROFILE_HEADER; media requests cannot, so they may use any.
const COOKIE_PREFIX = 'mntl_session_';
export const PROFILE_HEADER = 'x-mntl-user';
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

// Without SESSION_SECRET, sessions only last until the server restarts.
const secret = process.env.SESSION_SECRET || randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET && process.env.NODE_ENV === 'production') {
  console.warn('SESSION_SECRET is not set; sessions will be invalidated on restart');
}

function sign(value: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function setSessionUser(res: Response, mntlUserId: string): void {
  const expiresAt = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
  const payload = `${mntlUserId}.${expiresAt}`;
  res.cookie(`${COOKIE_PREFIX}${mntlUserId}`, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: MAX_AGE_SECONDS * 1000,
    path: '/',
  });
}

// Returns every MNTL profile this browser holds a valid session for.
export function getSessionUserIds(req: Request): string[] {
  return (req.headers.cookie || '')
    .split(';')
    .map(part => part.trim())
    .filter(part => part.startsWith(COOKIE_PREFIX))
    .flatMap(part => {
      const separator = part.indexOf('=');
      const cookieUserId = part.slice(COOKIE_PREFIX.length, separator);
      const [mntlUserId, expiresAt, signature] = decodeURIComponent(part.slice(separator + 1)).split('.');
      if (!mntlUserId || mntlUserId !== cookieUserId || !expiresAt || !signature) return [];

      const expected = Buffer.from(sign(`${mntlUserId}.${expiresAt}`));
      const actual = Buffer.from(signature);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return [];
      return Number(expiresAt) >= Date.now() / 1000 ? [mntlUserId] : [];
    });
}

// The profile a request acts for: the one named in the header, or the only session.
export function getSessionUserId(req: Request): string | null {
  const userIds = getSessionUserIds(req);
  const requested = req.get(PROFILE_HEADER);
  if (requested) return userIds.includes(requested) ? requested : null;
  return userIds.length === 1 ? userIds[0] : null;
}
