import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
let counter = 0;

async function register() {
  const n = ++counter;
  const email = `user${n}@test.dev`;
  const username = `user${n}`;
  const res = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { username, email, password: "password123" },
  });
  expect(res.statusCode).toBe(201);
  return { token: res.json().token as string, email, username };
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("Bug 2/3 - authentication", () => {
  it("returns 200 for a protected route with a valid token", async () => {
    const { token } = await register();
    const res = await app.inject({ method: "GET", url: "/cart", headers: auth(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [], total: 0 });
  });

  it("returns 401 (not 500) without a token", async () => {
    const res = await app.inject({ method: "GET", url: "/cart" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 401 for an invalid token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: auth("not-a-real-token"),
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("Bug 4 - minPrice filter", () => {
  it("returns only personas priced at or above minPrice", async () => {
    const res = await app.inject({ method: "GET", url: "/personas?minPrice=80" });
    expect(res.statusCode).toBe(200);
    const personas = res.json() as { price: number }[];
    expect(personas.length).toBeGreaterThan(0);
    for (const p of personas) expect(p.price).toBeGreaterThanOrEqual(80);
  });
});

describe("Bug 5 - login response", () => {
  it("includes username", async () => {
    const { email, username } = await register();
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, password: "password123" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({ email, username });
  });
});

describe("Bug 6 - checkout clears cart", () => {
  it("empties the cart after a successful order", async () => {
    const { token, email } = await register();
    await app.inject({
      method: "POST",
      url: "/cart",
      headers: auth(token),
      payload: { personaId: "p-001", quantity: 2 },
    });
    const order = await app.inject({
      method: "POST",
      url: "/checkout",
      headers: auth(token),
      payload: { name: "Test User", email },
    });
    expect(order.statusCode).toBe(201);

    const cart = await app.inject({ method: "GET", url: "/cart", headers: auth(token) });
    expect(cart.json().items).toHaveLength(0);
  });
});

describe("Bug 7 - CORS allows DELETE", () => {
  it("lists DELETE in the preflight response", async () => {
    const res = await app.inject({
      method: "OPTIONS",
      url: "/cart/abc",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "DELETE",
      },
    });
    expect(res.headers["access-control-allow-methods"]).toContain("DELETE");
  });
});

describe("Bug 8 - cart item ownership", () => {
  it("refuses to delete another user's cart item", async () => {
    const alice = await register();
    const bob = await register();
    const added = await app.inject({
      method: "POST",
      url: "/cart",
      headers: auth(alice.token),
      payload: { personaId: "p-001", quantity: 1 },
    });
    const itemId = added.json().items[0].id as string;

    const res = await app.inject({
      method: "DELETE",
      url: `/cart/${itemId}`,
      headers: auth(bob.token),
    });
    expect(res.statusCode).toBe(404);

    const aliceCart = await app.inject({ method: "GET", url: "/cart", headers: auth(alice.token) });
    expect(aliceCart.json().items).toHaveLength(1);
  });
});

describe("Bug 9 - favorites validation", () => {
  it("rejects a non-string personaId with 400", async () => {
    const { token } = await register();
    const res = await app.inject({
      method: "POST",
      url: "/favorites",
      headers: auth(token),
      payload: { personaId: 123 },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("Bug 17 - body-less DELETE", () => {
  it("succeeds when no Content-Type is sent (what the fixed client does)", async () => {
    const { token } = await register();
    await app.inject({
      method: "POST",
      url: "/favorites",
      headers: auth(token),
      payload: { personaId: "p-001" },
    });

    const withHeader = await app.inject({
      method: "DELETE",
      url: "/favorites/p-001",
      headers: { ...auth(token), "content-type": "application/json" },
    });
    expect(withHeader.statusCode).toBe(400);

    const withoutHeader = await app.inject({
      method: "DELETE",
      url: "/favorites/p-001",
      headers: auth(token),
    });
    expect(withoutHeader.statusCode).toBe(200);
  });
});
