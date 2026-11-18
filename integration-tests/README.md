# Astro integration tests

These tests build a small, real Astro project against the compiled `astro-precompressor` package. They exercise Astro's configuration loading and `astro:build:done` lifecycle hook rather than mocking the integration.

## Prerequisites

- Install the repository dependencies with `pnpm install`.
- Build the package with `pnpm build` (the test script below does this automatically).
- Run on a Node.js version supported by this package and Astro.

## Run

From the repository root:

```sh
pnpm test:integration
```

The Vitest configuration in this directory runs the integration suite serially. The fixture uses the repository's installed `astro` dependency through a temporary `node_modules` symlink, and imports the compiled package from `dist/index.js`.

## Coverage

1. **Real Astro build:** checks that Gzip and Brotli sidecars are generated and decompress byte-for-byte to the original HTML.
2. **Algorithm configuration:** checks that enabling only Brotli produces a valid `.br` file and does not produce Gzip or Zstandard sidecars.
3. **File filtering:** checks file-type inclusion and an exclude glob against actual Astro output, including files copied from `public/`.
4. **Incremental cache:** builds repeatedly using the same Astro cache directory, checks that the second build reuses artifacts, then changes one public asset and checks that the changed file is regenerated while an unchanged file is reused.

The test cleans the fixture's `dist/` and `.astro/` directories after execution. It also restores the modified public test asset.

## Add the package script

Add this script to the root `package.json`:

```json
{
  "scripts": {
    "test:integration": "pnpm build && vitest run --config integration-tests/vitest.config.ts"
  }
}
```

The fixture deliberately does not declare its own Astro dependency: it uses the exact Astro version installed by the package's development dependencies, avoiding a second install and version drift.
