# Bug-Fix Plan — Agentic Personas Storefront

> **Status: complete** on branch `fix/storefront-bugs`. All 17 bugs fixed; `pnpm build` ✓, `pnpm typecheck` 4/4 ✓, `pnpm test` 10/10 ✓, browser walkthrough ✓.
> Deviations from plan: CORS config moved into a new `apps/api/src/app.ts` (`buildApp()`); Bug 9 adds `addFavoriteSchema` to `@acme/shared`; README also had pre-existing mojibake repaired.

Companion to the **Known Bugs & How to Verify** section in `README.md`. Bug numbers below match that section.

## Goals

1. Make the app work end-to-end in the browser (browse → search → login → favorite → cart → checkout → logout).
2. Make `pnpm build` **and** `pnpm typecheck` pass.
3. Add a minimal automated regression net (API integration tests via Fastify `inject`) so fixes stay fixed.
4. Keep every change surgical — no refactors, no new runtime dependencies.

## Non-goals

- Replacing the in-memory store, the toy password hash, or the hard-coded JWT secret (documented in README *Security notes*; out of scope for the assessment).
- Visual/UX redesign.

---

## Principles

- **Fix root causes, not symptoms.** E.g. Bug 2 is fixed in `authenticate`, not by null-guarding every route.
- **One commit per phase**, each leaving the repo green (`pnpm build && pnpm typecheck`, plus tests once they exist).
- **Order by blast radius.** Auth and transport bugs mask UI bugs; fix them first so later UI fixes can actually be verified in the browser.
- **Prefer the smallest code change** that satisfies the README "Expected" column.

---

## Phase 0 — Baseline & test harness

| Step | Action | Done when |
|---|---|---|
| 0.1 | `git checkout -b fix/storefront-bugs` | branch exists |
| 0.2 | Record baseline: `pnpm build` (passes), `pnpm typecheck` (fails on TS4023) | noted in commit message |
| 0.3 | Add `vitest` as a dev dependency to `apps/api` only; add `"test": "vitest run"` script and a root `turbo` `test` task | `pnpm --filter @acme/api test` runs (0 tests) |
| 0.4 | Extract `buildApp()` from `apps/api/src/index.ts` so tests can `app.inject()` without binding a port (`index.ts` keeps `listen()`); no behaviour change | build still passes, server still starts on 3001 |
| 0.5 | Write failing tests for Bugs 2, 3, 4, 5, 6, 7, 8, 17 (red) | tests fail for the documented reasons |

> Rationale for API-only tests: all backend bugs are observable with `inject()` and zero browser tooling. Frontend bugs are verified manually via the README steps (a Playwright setup is overkill for 8 one-line fixes).

---

## Phase 1 — Build / toolchain

| Bug | File | Change |
|---|---|---|
| **1** | `apps/web/src/routes/index.tsx` | `export interface SearchParams` |

**Verify:** `pnpm typecheck` → all three packages pass.
**Risk:** none.

---

## Phase 2 — Backend: auth & transport (unblocks everything else)

| Bug | File | Change |
|---|---|---|
| **2** | `apps/api/src/middleware/auth.ts` | Always `await request.jwtVerify()`. On failure: if `ENFORCE_AUTH` → 401; else still 401 (a protected route cannot work without a user). Effectively `ENFORCE_AUTH` becomes a no-op; keep reading it so the env var doesn't break, document in README. |
| **3** | same file | `return reply.status(401).send(...)` so the handler is short-circuited. |
| **7** | `apps/api/src/index.ts` | Add `"DELETE"` to CORS `methods`. |
| **17** | `apps/web/src/lib/api.ts` | Only set `Content-Type: application/json` when `options.body` is defined. |

**Decision point for Bug 2:** the alternative is "when not enforced, synthesize a dev user". That hides the auth path and is riskier; rejected. Protected routes will simply require a token in all modes.

**Verify:** tests for 2/3/7/17 go green; `curl GET /cart` with token → 200; bad token → 401 with no "reply already sent" log; OPTIONS preflight lists DELETE.
**Risk:** low. Any existing caller relying on unauthenticated access to `/cart` etc. was already getting 500s.

---

## Phase 3 — Backend: data & logic

| Bug | File | Change |
|---|---|---|
| **4** | `apps/api/src/db.ts` `personas.search` | `p.price >= filters.minPrice` |
| **5** | `apps/api/src/routes/auth.ts` login | add `username: user.username` to `user` in response |
| **6** | `apps/api/src/routes/checkout.ts` | after `db.orders.create(order)` call `db.cart.clearForUser(userId)` |
| **8** | `apps/api/src/routes/cart.ts` DELETE | treat `item.userId !== userId` the same as not-found → 404 (mirrors the existing PUT handler) |
| **9** | `apps/api/src/routes/favorites.ts` POST | parse body with `z.object({ personaId: z.string().min(1) })` for consistency with cart/checkout (current code already 400s on missing id, so this is hygiene, not a functional fix) |

**Verify:** tests for 4/5/6/8 green; `GET /personas?minPrice=80` → 2 results; checkout then `GET /cart` → empty; cross-user DELETE → 404.
**Risk:** Bug 6 — `clearForUser` must run *after* the order is persisted and *only* on the success path (keep it below the stock/validation early-returns).

---

## Phase 4 — Frontend

| Bug | File | Change |
|---|---|---|
| **10** | `components/PersonaCard.tsx` | `${persona.price.toFixed(2)}` (drop `* 100`) |
| **11** | `routes/index.tsx` | `queryKey: ["personas", search]` (the normalized search object) |
| **12** | `routes/personas/$personaId.tsx` `toggleFavorite` | swap branches: `isFavorited ? delete : post` |
| **13** | same file, favorites `useQuery` | add `enabled: !!user` |
| **14** | `routes/__root.tsx` | `queryKey: ["cart"]` so cart mutations' `invalidateQueries({queryKey:["cart"]})` refresh the badge |
| **15** | `lib/auth.tsx` `logout` | `localStorage.removeItem("auth_token")`; also `queryClient.clear()` (import the singleton from `~/lib/queryClient` — `AuthProvider` already sits inside `QueryClientProvider` in `main.tsx`, so `useQueryClient()` would work too) |
| **16** | `components/CartItem.tsx` | `disabled={item.quantity <= 1}` on the **−** button |

**Verify (manual, per README steps):**
- Card price matches detail page.
- Typing in search triggers `GET /personas?q=…` and grid updates.
- Heart: first click → `POST /favorites`, fills; second → `DELETE`, empties.
- Logged-out detail page makes no `/favorites` request.
- Add to cart → navbar badge increments immediately.
- Logout → F5 → still logged out; `localStorage.auth_token` is gone.
- **−** disabled at qty 1.

**Risk:** Bug 11 — key on the *parsed* search object (stable shape) rather than the raw URL string so unchanged values don't trigger spurious refetches. Bug 15 — none; provider order confirmed.

---

## Phase 5 — Documentation & cleanup

- Update `README.md`:
  - Mark each bug **Fixed** with the commit/short description; keep the verify steps as regression instructions.
  - Fix the Bug 6 verify snippet — `POST /checkout` requires a body (`{"name":"…","email":"…"}`), the current snippet omits it.
  - Note the new `pnpm test` command and that `ENFORCE_AUTH` is now effectively always on.
- Delete `plan.md`? **No** — keep it; it's the audit trail for the assessment. Add a "Status" line at the top when done.
- `git status` must show no stray `routeTree.gen.ts` line-ending churn (revert if the Vite plugin regenerates it).

---

## Execution order & commits

```
0  chore(api): add vitest + buildApp() factory + failing regression tests
1  fix(web): export SearchParams so declaration emit succeeds (TS4023)        [Bug 1]
2  fix(api): always verify JWT and short-circuit on 401; allow DELETE in CORS  [Bugs 2,3,7]
   fix(web): don't send Content-Type on body-less requests                    [Bug 17]
3  fix(api): minPrice comparison, login username, clear cart after checkout,
            cart-item ownership check, validate favorites body                [Bugs 4,5,6,8,9]
4  fix(web): price display, search refetch, favorite toggle, cart badge,
            logout, qty decrement guard                                       [Bugs 10–16]
5  docs: mark bugs fixed, correct checkout verify snippet, document pnpm test
```

Phases 2 → 3 → 4 are sequential (each depends on the previous being verifiable). Phase 1 is independent and can land first.

---

## Definition of done

- [ ] `pnpm build` passes
- [ ] `pnpm typecheck` passes (3/3 packages)
- [ ] `pnpm --filter @acme/api test` passes (≥ 8 regression tests, one per backend bug + Bug 17's empty-body case)
- [ ] Manual browser walkthrough: register → search "code" → open persona → favorite → add to cart ×2 → change qty → remove one → checkout → cart empty → logout → reload stays logged out
- [ ] README bug table updated; every entry reproducible from a clean clone
- [ ] No API/web processes left running; port 3001/5173 free

## Estimated effort

| Phase | Size |
|---|---|
| 0 | ~45 min (harness + 8 tests) |
| 1 | 2 min |
| 2 | 15 min |
| 3 | 15 min |
| 4 | 25 min |
| 5 | 15 min |
| **Total** | **~2 h** |
