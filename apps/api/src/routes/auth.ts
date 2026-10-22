import type { FastifyInstance } from "fastify";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { registerSchema, loginSchema, type AuthResponse } from "@acme/shared";
import { db } from "../db.js";
import { authenticate } from "../middleware/auth.js";

const KEY_LENGTH = 64;

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return timingSafeEqual(actual, expected);
}

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/register", async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const { username, email, password } = parsed.data;

    if (db.users.getByEmail(email)) {
      return reply.status(409).send({ error: "Email already registered" });
    }

    const id = randomUUID();
    const user = db.users.create({
      id,
      username,
      email,
      passwordHash: hashPassword(password),
    });

    const token = app.jwt.sign({ id: user.id, email: user.email });
    const response: AuthResponse = {
      token,
      user: { id: user.id, username: user.username, email: user.email },
    };

    return reply.status(201).send(response);
  });

  app.post("/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const { email, password } = parsed.data;
    const user = db.users.getByEmail(email);

    if (!user || !verifyPassword(password, user.passwordHash)) {
      return reply.status(401).send({ error: "Invalid email or password" });
    }

    const token = app.jwt.sign({ id: user.id, email: user.email });
    const response: AuthResponse = {
      token,
      user: { id: user.id, username: user.username, email: user.email },
    };

    return response;
  });

  app.get(
    "/auth/me",
    { preHandler: [authenticate] },
    async (request, reply) => {
      const payload = request.user as { id: string; email: string };
      const user = db.users.getById(payload.id);
      if (!user) {
        return reply.status(404).send({ error: "User not found" });
      }
      return { id: user.id, username: user.username, email: user.email };
    }
  );
}
