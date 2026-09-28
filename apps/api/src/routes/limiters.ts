import rateLimit from 'express-rate-limit';

const message = (what: string) => ({
  error: { code: 'RATE_LIMITED', message: `Too many ${what} requests — slow down and try again shortly.` },
});

/** Verification involves hashing uploads — keep it enthusiast-friendly but bounded. */
export const verifyLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: message('verification'),
});

export const aiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: message('analysis'),
});

export const demoLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: message('demo'),
});
