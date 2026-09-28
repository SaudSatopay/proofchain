import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db.js';
import { unauthorized } from '../errors.js';
import { requireAuth, signToken } from '../middleware/auth.js';

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many login attempts — try again later.' } },
});

const LoginSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

authRouter.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = LoginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw unauthorized('Invalid email or password');
    }
    const session = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role as never,
    };
    res.json({ token: signToken(session), user: session });
  } catch (err) {
    next(err);
  }
});

authRouter.get('/me', requireAuth(), (req, res) => {
  res.json({ user: req.user });
});
