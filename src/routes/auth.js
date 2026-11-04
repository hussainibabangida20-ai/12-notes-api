import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { config } from "../config.js";
import { sql } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../lib/validate.js";

const router = Router();

const registerSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email().transform((email) => email.toLowerCase()),
  password: z.string()
    .min(10)
    .regex(/^(?=.*[A-Za-z])(?=.*\d).+$/, "Password must contain letters and numbers"),
});

const loginSchema = z.object({
  email: z.string().trim().email().transform((email) => email.toLowerCase()),
  password: z.string().min(1),
});

const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler(_req, res) {
    res.status(429).json({
      error: { message: "Too many authentication requests. Please try again later." },
    });
  },
});

function createToken(userId) {
  return jwt.sign({ sub: userId }, config.JWT_SECRET, {
    expiresIn: "1h",
    algorithm: "HS256",
  });
}

function toPublicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    created_at: user.created_at,
  };
}

router.use(authRateLimit);

router.post("/register", validate(registerSchema), async (req, res) => {
  const { name, email, password } = req.body;
  const passwordHash = await bcrypt.hash(password, 12);

  let user;
  try {
    [user] = await sql`
      INSERT INTO users (name, email, password_hash)
      VALUES (${name}, ${email}, ${passwordHash})
      RETURNING id, name, email, created_at
    `;
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        error: { message: "An account with this email already exists" },
      });
    }
    throw error;
  }

  const token = createToken(user.id);
  return res.status(201).json({ user: toPublicUser(user), token });
});

router.post("/login", async (req, res) => {
  const invalidCredentials = () => res.status(401).json({
    error: { message: "Invalid email or password" },
  });
  const result = loginSchema.safeParse(req.body);

  if (!result.success) {
    return invalidCredentials();
  }

  const { email, password } = result.data;
  const [user] = await sql`
    SELECT id, name, email, password_hash, created_at
    FROM users
    WHERE email = ${email}
    LIMIT 1
  `;

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return invalidCredentials();
  }

  const token = createToken(user.id);
  return res.json({ token, user: toPublicUser(user) });
});

router.get("/me", requireAuth, async (req, res) => {
  const [user] = await sql`
    SELECT id, name, email, created_at
    FROM users
    WHERE id = ${req.user.id}
    LIMIT 1
  `;

  if (!user) {
    res.set("WWW-Authenticate", 'Bearer realm="api", error="invalid_token"');
    return res.status(401).json({ error: { message: "Invalid or expired token" } });
  }

  return res.json({ user: toPublicUser(user) });
});

export default router;
