# Testing Design — vibe-transit

**Date:** 2026-05-12
**Status:** Implemented

---

## 1. Context

vibe-transit is a Next.js application for syncing GTFS transit data into Supabase. Testing was added to establish a safety net for the two core areas of business logic that had already been written: the GTFS ZIP parser and the SyncForm UI component. The goals are:

- Catch regressions in parsing logic (type coercion, null fallbacks, error paths).
- Verify SyncForm UI states (mode switching, loading, success, error) without a running server.
- Provide a coverage baseline that grows with the codebase.

---

## 2. Scope

- **In scope:** unit tests and component tests (run in jsdom).
- **Out of scope:** end-to-end tests (no Playwright/Cypress). Integration tests against a real Supabase instance are also excluded.
- Coverage reporting is enabled via `yarn test:coverage`.

---

## 3. Stack

| Package | Version | Role |
|---|---|---|
| `vitest` | ^4.1.6 | Test runner and assertion library |
| `@vitejs/plugin-react` | ^6.0.1 | JSX transform inside Vite/Vitest |
| `vite-tsconfig-paths` | ^6.1.1 | Resolves `@/` path aliases in test files |
| `jsdom` | ^29.1.1 | DOM environment for component tests |
| `@testing-library/react` | ^16.3.2 | Component rendering and querying |
| `@testing-library/dom` | ^10.4.1 | Underlying DOM utilities |
| `@testing-library/jest-dom` | ^6.9.1 | Custom matchers (`toBeInTheDocument`, etc.) |
| `@vitest/coverage-v8` | ^4.1.6 | V8-based coverage provider |

`globals: true` is required because `@testing-library/react` v16 registers its auto-cleanup hook via `afterEach` on the global scope. Without it, cleanup does not run and tests leak DOM state between cases.

---

## 4. Configuration

### `vitest.config.mts`

Located at the project root. Key settings:

- **plugins:** `tsconfigPaths()` (resolves `@/` aliases) and `react()` (JSX).
- **environment:** `jsdom` — applies to all tests.
- **globals:** `true` — exposes `describe`, `it`, `expect`, `vi`, and lifecycle hooks globally; required for RTL auto-cleanup.
- **setupFiles:** `['./vitest.setup.ts']` — runs once per worker before any test file.
- **coverage.provider:** `v8`.
- **coverage.reporter:** `['text', 'html', 'lcov']` — terminal summary, browsable HTML report, and LCOV for CI integration.
- **coverage.include:** `['app/**', 'components/**', 'lib/**']`.
- **coverage.exclude:** test files, spec files, `vitest.setup.ts`, and `vitest.config.*`.

### `vitest.setup.ts`

Single import:

```ts
import '@testing-library/jest-dom/vitest'
```

This registers the jest-dom custom matchers (e.g. `toBeInTheDocument`, `toBeDisabled`, `toHaveTextContent`) with Vitest's `expect`.

---

## 5. Test File Convention

Tests are colocated with their source module under a `__tests__` subdirectory:

```
<module>/
  __tests__/
    <file>.test.ts     # pure logic / unit
    <file>.test.tsx    # React component
```

Examples:
- `lib/gtfs/__tests__/parse.test.ts`
- `components/__tests__/SyncForm.test.tsx`

All vitest symbols (`describe`, `it`, `expect`, `vi`, `beforeEach`, `afterEach`) are imported explicitly from `'vitest'`, not consumed from globals. This keeps IDE type resolution unambiguous.

---

## 6. Test Scripts

| Script | Command | Behaviour |
|---|---|---|
| `yarn test` | `vitest` | Watch mode; re-runs on file change |
| `yarn test:run` | `vitest run` | Single pass, no watch; suitable for CI |
| `yarn test:coverage` | `vitest run --coverage` | Single pass with V8 coverage output |

---

## 7. What Was Built

### `lib/gtfs/__tests__/parse.test.ts` — 11 unit tests

Tests for `parseGtfsZip`, grouped into four `describe` blocks:

| Group | Tests |
|---|---|
| happy path | parses stops and routes from valid ZIP; verifies stop shape; verifies route shape |
| missing files | throws when `stops.txt` absent; throws when `routes.txt` absent |
| field type coercion | `stop_lat`/`stop_lon` parsed as `number`; `route_type` parsed as integer |
| null fallback | empty optional strings coerced to `null`; absent columns coerced to `null` |

Fixtures are built at runtime using real `JSZip` instances (see Patterns below).

### `components/__tests__/SyncForm.test.tsx` — 7 component tests

Tests for the `SyncForm` component, all using RTL's `render`/`screen`/`fireEvent`/`waitFor`:

| Test | What it asserts |
|---|---|
| renders in ZIP mode by default | drop zone visible; URL input absent |
| switches to API mode | URL input appears after clicking "API URL" |
| switches back to ZIP mode | drop zone reappears after toggling back |
| loading state | button becomes "Syncing…" and disabled while fetch is pending |
| success result | pill displays stop and route counts from `rowsInserted` payload |
| error from `ok: false` | error message from response body shown in pill |
| error from thrown exception | network error message shown in pill |

---

## 8. Patterns Established

### Explicit vitest imports

Even though `globals: true` makes symbols available without imports, all test files import explicitly:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
```

This prevents ambiguity when editors resolve types and makes the test file self-documenting.

### `vi.stubGlobal` / `vi.unstubAllGlobals` for fetch mocking

Component tests that exercise network behaviour stub `fetch` on the global object:

```ts
beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => { vi.unstubAllGlobals(); });
```

`vi.unstubAllGlobals()` is preferred over manual teardown; it restores every stubbed global automatically.

### Real JSZip fixtures for GTFS tests

Rather than shipping binary fixture files, `parse.test.ts` builds ZIP buffers in-process using the production `jszip` dependency:

```ts
async function buildZip(files: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return Buffer.from(await zip.generateAsync({ type: 'arraybuffer' }));
}
```

This keeps fixtures readable (plain CSV strings in the test file), avoids binary blobs in version control, and exercises the same code path the production parser uses.
