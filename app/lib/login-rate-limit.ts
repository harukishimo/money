interface AttemptWindow {
  count: number;
  resetAt: number;
}

const attempts = new Map<string, AttemptWindow>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export function loginRateLimitKey(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

export function canAttemptLogin(key: string, now = Date.now()) {
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 0, resetAt: now + WINDOW_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  return {
    allowed: current.count < MAX_ATTEMPTS,
    retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
  };
}

export function recordFailedLogin(key: string, now = Date.now()) {
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    current.count += 1;
  }
}

export function clearLoginAttempts(key: string) {
  attempts.delete(key);
}
