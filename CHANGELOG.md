# Changelog

## 1.0.3 - 2026-06-03

### Changed
- Reworked `config.schema.json` to declare mandatory fields via a standard top-level JSON Schema `required` array (`name`, `email`, `password`, `stoveID`) instead of per-property `required` booleans.
- `stoveID` is now marked as required in the configuration UI, with its description updated accordingly. The runtime still auto-detects the stove when an account has exactly one.

## 1.0.2 - 2026-06-03

### Security
- Upgraded the Vitest toolchain (`vitest` and `@vitest/coverage-v8`) from 2.x to 4.x to resolve two critical advisories ([GHSA-5xrq-8626-4rwp](https://github.com/advisories/GHSA-5xrq-8626-4rwp)) and related moderate `esbuild` advisories. These were development-only dependencies and did not affect the published runtime, which has no production dependencies.
