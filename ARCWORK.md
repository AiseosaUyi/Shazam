# Learnings

- `new URL()` normalizes `../` path segments away, so SSRF-safe code must check for `..` in the raw input string (before relying on URL class behavior).
- Build/test command: `npx tsc --noEmit` for typecheck; `node --experimental-sqlite --no-warnings --import tsx --test tests/*.test.ts` for test suite.
- The existing project uses z.union discriminants in schemas (`markdown`, `url`, `name`) to differentiate input variants — no special discriminator key needed since Zod matches sequentially.
