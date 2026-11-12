# astro-precompressor

An [Astro](https://astro.build/) integration that precompresses build output using Brotli and Gzip.

`astro-precompressor` generates compressed `.br` and `.gz` files alongside your original build output, allowing compatible web servers and hosting platforms to serve precompressed content without compressing it on every request.

## Features

- Brotli and Gzip compression.
- Optional [Zopfli](https://github.com/pierreinglebert/node-zopfli-es) compression for Gzip.
- Configurable file types and compression algorithms.
- Incremental compression with caching.
- Configurable concurrency.
- Compression statistics and configurable logging.
- Preserves original build files.

## Installation

Install the integration using your preferred package manager:

```bash
pnpm add -D astro-precompressor
```

```bash
npm install -D astro-precompressor
```

```bash
yarn add -D astro-precompressor
```

```bash
bun add -d astro-precompressor
```

Astro is provided as a peer dependency and must be installed in your project.

### Optional: Zopfli support

Zopfli can produce smaller Gzip files, at the cost of increased compression time.

To enable it, install the optional `node-zopfli-es` package:

```bash
pnpm add -D node-zopfli-es
```

Zopfli is only used for Gzip compression. Brotli compression continues to use Node.js's built-in compression support.

## Usage

Add the integration to your Astro configuration:

```ts
import { defineConfig } from 'astro/config'
import precompressor from 'astro-precompressor'

export default defineConfig({
	integrations: [precompressor()],
})
```

The integration runs after Astro has completed its build and generates compressed versions of eligible output files.

## Configuration

You can customise the integration by passing options to `precompressor()`:

```ts
import { defineConfig } from 'astro/config'
import precompressor from 'astro-precompressor'

export default defineConfig({
	integrations: [
		precompressor({
			algorithms: ['brotli', 'gzip'],
			useZopfli: true,
		}),
	],
})
```

The available options include:

| Option                     | Description                                                                     |
| -------------------------- | ------------------------------------------------------------------------------- |
| `algorithms`               | Compression algorithms to use: `brotli`, `gzip`, or both.                       |
| `fileTypes`                | File extensions eligible for compression.                                       |
| `useZopfli`                | Enables Zopfli for Gzip compression. Can also be used to supply Zopfli options. |
| `concurrency`              | Maximum number of files processed concurrently.                                 |
| `incremental`              | Enables incremental compression using the cache.                                |
| `minSize`                  | Minimum file size eligible for compression.                                     |
| `failOnError`              | Controls whether compression errors fail the build.                             |
| `prune`                    | Controls removal of obsolete cached artifacts.                                  |
| `recompressOnConfigChange` | Controls whether cached files are regenerated when the configuration changes.   |
| `logLevel`                 | Controls the amount of logging produced by the integration.                     |

See the TypeScript definitions for the complete option types and defaults.

## Output

For each eligible file, the integration generates compressed variants alongside the original file.

For example:

```text
dist/
├── index.html
├── index.html.br
├── index.html.gz
├── about/
│   ├── index.html
│   ├── index.html.br
│   └── index.html.gz
└── ...
```

The original files are retained.

## Deployment

This integration generates precompressed files; it does not configure your web server or hosting platform to serve them.

Your server must be configured to negotiate the appropriate representation using the request's `Accept-Encoding` header and serve the corresponding file with the correct `Content-Encoding` response header:

- Brotli: `Content-Encoding: br`
- Gzip: `Content-Encoding: gzip`

Responses should also include an appropriate `Vary: Accept-Encoding` header so that caches distinguish between compressed and uncompressed representations.

Consult your hosting provider's documentation for instructions on enabling precompressed static file serving.

## Requirements

- Astro `^7.4.6`
- A supported Node.js version for your Astro installation.
- `node-zopfli-es` (optional; required only when Zopfli is enabled).

## License

[MIT](LICENSE) © Jason P. Cochrane
