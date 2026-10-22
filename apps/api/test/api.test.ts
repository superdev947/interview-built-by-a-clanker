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

describe("N1 - password hashing", () => {
  it("rejects a password that collided under the old 32-bit hash", async () => {
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { username: "victim", email: "victim@test.dev", password: "AaAaAa" },
    });
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "victim@test.dev", password: "BBBBBB" },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("N2/N3 - token hardening", () => {
  it("issues tokens with an expiry and a non-sequential user id", async () => {
    const { token } = await register();
    const decoded = app.jwt.decode<{ id: string; exp?: number }>(token)!;
    expect(decoded.exp).toBeTypeOf("number");
    expect(decoded.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects a validly signed token for a user that does not exist", async () => {
    const ghost = app.jwt.sign({ id: "user-999", email: "ghost@test.dev" });
    const res = await app.inject({
      method: "POST",
      url: "/cart",
      headers: auth(ghost),
      payload: { personaId: "p-001", quantity: 1 },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("N4 - search query validation", () => {
  it("returns 400 instead of 500 for a repeated q parameter", async () => {
    const res = await app.inject({ method: "GET", url: "/personas?q=a&q=b" });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for a non-numeric price", async () => {
    const res = await app.inject({ method: "GET", url: "/personas?maxPrice=abc" });
    expect(res.statusCode).toBe(400);
  });
});

describe("N5 - quantity cap", () => {
  it("rejects absurd quantities and caps merged quantities", async () => {
    const { token } = await register();
    const huge = await app.inject({
      method: "POST",
      url: "/cart",
      headers: auth(token),
      payload: { personaId: "p-001", quantity: 1e15 },
    });
    expect(huge.statusCode).toBe(400);

    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: "POST",
        url: "/cart",
        headers: auth(token),
        payload: { personaId: "p-001", quantity: 50 },
      });
    }
    const cart = await app.inject({ method: "GET", url: "/cart", headers: auth(token) });
    expect(cart.json().items[0].quantity).toBe(100);
  });
});

describe("N8 - email normalization", () => {
  it("treats emails case-insensitively", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { username: "casey", email: "Casey@Test.dev", password: "secret1" },
    });
    expect(first.statusCode).toBe(201);
    const dup = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { username: "casey2", email: "casey@test.dev", password: "secret1" },
    });
    expect(dup.statusCode).toBe(409);
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "CASEY@TEST.DEV", password: "secret1" },
    });
    expect(login.statusCode).toBe(200);
  });
});
describe("N15 - indexed lookups stay consistent", () => {
  it("re-adds a persona after removing it or checking out", async () => {
    const { token, email } = await register();
    const add = () =>
      app.inject({
        method: "POST",
        url: "/cart",
        headers: auth(token),
        payload: { personaId: "p-002", quantity: 2 },
      });

    const first = (await add()).json();
    const firstId = first.items[0].id as string;
    await app.inject({ method: "DELETE", url: `/cart/${firstId}`, headers: auth(token) });

    const second = (await add()).json();
    expect(second.items).toHaveLength(1);
    expect(second.items[0].quantity).toBe(2);
    expect(second.items[0].id).not.toBe(firstId);

    await app.inject({
      method: "POST",
      url: "/checkout",
      headers: auth(token),
      payload: { name: "Index Test", email },
    });
    const third = (await add()).json();
    expect(third.items).toHaveLength(1);
    expect(third.items[0].quantity).toBe(2);
  });
});