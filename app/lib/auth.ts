import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { jwtVerify, SignJWT } from "jose";

const scrypt = promisify(scryptCallback);

export const SESSION_COOKIE = "futari_household_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const HASH_PREFIX = "scrypt";

function sessionKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters.");
  }
  return new TextEncoder().encode(secret);
}

export async function createPasswordHash(password: string) {
  if (password.length < 12) throw new Error("Password must be at least 12 characters.");
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `${HASH_PREFIX}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, encodedHash = process.env.APP_PASSWORD_HASH) {
  if (!encodedHash || password.length < 1 || password.length > 256) return false;
  const [algorithm, saltText, hashText, ...extra] = encodedHash.split("$");
  if (algorithm !== HASH_PREFIX || !saltText || !hashText || extra.length > 0) return false;

  try {
    const salt = Buffer.from(saltText, "base64url");
    const expected = Buffer.from(hashText, "base64url");
    if (salt.length !== 16 || expected.length !== 64) return false;
    const actual = await scrypt(password, salt, expected.length) as Buffer;
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export async function createSessionToken() {
  return new SignJWT({ role: "household" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject("shared-household")
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(sessionKey());
}

export async function verifySessionToken(token: string | undefined) {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, sessionKey(), { algorithms: ["HS256"] });
    return payload.sub === "shared-household" && payload.role === "household";
  } catch {
    return false;
  }
}

export function sessionCookieOptions() {
  return {
    name: SESSION_COOKIE,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}
