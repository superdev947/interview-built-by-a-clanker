import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { personaRoutes } from "./routes/personas.js";
import { authRoutes } from "./routes/auth.js";
import { cartRoutes } from "./routes/cart.js";
import { favoriteRoutes } from "./routes/favorites.js";
import { checkoutRoutes } from "./routes/checkout.js";

const DEV_JWT_SECRET = "agentic-personas-dev-secret";

function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET must be set in production");
  }
  return DEV_JWT_SECRET;
}

export async function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? true });

  await app.register(cors, {
    origin: "http://localhost:5173",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  });
  await app.register(jwt, {
    secret: resolveJwtSecret(),
    sign: { expiresIn: process.env.JWT_EXPIRES_IN ?? "1h" },
  });

  await app.register(personaRoutes);
  await app.register(authRoutes);
  await app.register(cartRoutes);
  await app.register(favoriteRoutes);
  await app.register(checkoutRoutes);

  app.get("/health", async () => ({ status: "ok" }));

  return app;
}
