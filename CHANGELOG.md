# Changelog

## 1.0.2 - 2026-06-03

### Security
- Upgraded the Vitest toolchain (`vitest` and `@vitest/coverage-v8`) from 2.x to 4.x to resolve two critical advisories ([GHSA-5xrq-8626-4rwp](https://github.com/advisories/GHSA-5xrq-8626-4rwp)) and related moderate `esbuild` advisories. These were development-only dependencies and did not affect the published runtime, which has no production dependencies.
