import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { db } from "../db.js";

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({ error: "Unauthorized" });
  }

  const { id } = request.user as { id?: string };
  if (!id || !db.users.getById(id)) {
    return reply.status(401).send({ error: "Unauthorized" });
  }
}

export function registerAuthHook(app: FastifyInstance) {
  app.decorate("authenticate", authenticate);
}
