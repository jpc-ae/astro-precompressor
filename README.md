# astro-precompressor

An Astro integration that precompresses build output using Gzip, Brotli and,
optionally, Zstandard.

`astro-precompressor` runs after Astro finishes building your project,
generating compressed sidecar files alongside eligible output files for your
server to use instead of on-the-fly compression. It uses incremental caching to
avoid unnecessary recompression between builds (the main motivation for building
this integration) and supports configurable algorithms, file filtering, and
performance.

## Motivation

While various compression options exist for astro builds, they either do not
offer caching or are too complicated to configure for common options like file
filtering. They are also either restricted to node's zlib library or require
commandline scripts.

This package attempts to provide the easiest possible configuration without
compromise while ensuring the fastest possible build and, more importantly,
rebuild times. It also offers optional Zopfli for better gzip compression, and
is open to adding other engines on request (please
[open an issue](https://github.com/jpc-ae/astro-precompressor/issues) for any
requests).

## Features

- **Sane defaults:** Gzip & Brotli set for maximum compression without redundant
  processing, with Zstandard off but available if needed (it being better suited
  to on-the-fly compression).
- **Highly configurable:** Fine-tune algorithm-specific compression settings,
  performance options, file filtering and cleanup.
- **Optional Zopfli:** Install the `node-zopfli-es` package into your project
  for smaller gzip output.
- **Incremental builds:** Reuse cached compression artifacts when source files
  haven't changed, preserving original compression timestamps.
- **Detailed filtering:** Specify file extensions, a minimum size, and include
  or exclude paths using glob patterns.
- **Compression size checks:** Discard compressed outputs that are not smaller
  than their originals.
- **Detailed logging:** Choose between a basic summary, per-file statistics
  similar to Astro's build logs, and detailed diagnostic output.

## Installation

```bash
# npm
npm install -D astro-precompressor

# pnpm
pnpm add -D astro-precompressor

# yarn
yarn add -D astro-precompressor

# bun
bun add -d astro-precompressor
```

### Optional Zopfli

If you want to use Zopfli for gzip compression, add the `node-zopfli-es` package
to your install script above. It will be autodetected and enabled by default,
unless you explicitly disable zopfli or provide your own zlib options (See
below).

## Usage

Import the integration into your Astro configuration and add it as the last item
of the integrations array.

```ts
// astro.config.ts
import { defineConfig } from 'astro/config'
import precompressor from 'astro-precompressor'

export default defineConfig({
	integrations: [
		//...
		precompressor(),
	],
})
```

> [!CAUTION] Astro runs integrations in the order they are listed. To avoid
> subsequent integrations from affecting compressed files, and to ensure any
> files created or modified by other integrations are compressed appropriately,
> always ensure that this integration sits last in the list.

## Configuration

The integration accepts an optional configuration object.

```ts
precompressor({
	algorithms: {
		brotli: false,
		zstd: true,
	},
	filters: {
		minSize: 1024,
		fileTypes: ['.html', '.css', '.js', '.svg', '.txt'],
		include: ['www/**'],
		exclude: ['**/*.env', '**/.*/**'],
	},
	logLevel: 0,
})
```

Any provided options will be merged with the defaults. The following sections
describe the details of each option.

### Compression Algorithms

The `algorithms` option controls which compression algorithms are enabled and
their individual settings. Each algorithm accepts either a boolean (`true` or
`false`) or an options object that will be passed through directly to the
compression engine. Below are the defaults.

```ts
algorithms: {
  gzip: true,
  brotli: true,
  zstd: false,
}
```

#### Gzip

Gzip supports two compression engines:

- **zlib:** The standard Node.js compression implementation.
- **Zopfli:** An optional, more computationally intensive implementation that
  generally produces smaller Gzip files. It depends on the `node-zopfli-es`
  package.

Without `node-zopfli-es` installed, the following zlib options are used. They
ensure maximum compression with this engine.

```ts
gzip: {
  level: constants.Z_BEST_COMPRESSION,
  memLevel: constants.Z_MAX_MEMLEVEL,
}
```

When `node-zopfli-es` is installed in the base astro project, it should be
detected and used automatically. It can also be explicitly enabled, in which
case the build will fail when the package is missing. It's default settings are
below.

```ts
gzip: {
  zopfli: {
    numiterations: 5,
    blocksplitting: false,
  },
}
```

> [!TIP] While higher `numiterations` can produce smaller file sizes, it does so
> at the expense of speed. 15 is often considered a good default, but did not
> meaningfully affect the final compression ratios in testing while taking 3
> times longer. `numiterations: 5` already produces a smaller output than `zlib`
> in most cases while running at a similar speed. `blocksplitting` has also been
> turned off for a similar reason. Feel free to experiment if maximum gzip
> compression is a priority for you rather than relying on `brotli`.

#### Brotli

The default brotli options ensure maximum compression without taxing your
machine.

```ts
brotli: {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
    },
  }
```

#### Zstandard

Since brotli compresses better in almost all cases (at the expense of speed) and
has been available in browsers for longer, it should be preferred. Zstandard is
instead an attractive middleware on server rendered pages where compression
speed and resource usage matters more.

This integration is exclusively for precompressing static assets. Zstandard is
therefore disabled by default. It can, however, be enabled by setting its
property to true or providing a configuration object. The default settings for
`zstd` are below, providing maximum compression without overly taxing your
system.

```ts
zstd: {
	params: {
		[constants.ZSTD_c_compressionLevel]: 19,
	},
}
```

> [!CAUTION] 19 is the maximum sane limit for parallel compression. If you set
> this level higher (ultra levels 20-22), be sure to set the
> `performance.concurrency` option as well to an appropriately conservative
> number (like 1) and preferably make sure you're running it on a beefy server
> to avoid stalling or running out of memory.

### File Filtering

The `filters` option controls which build output files should be compressed. Its
default options are below

```ts
WEB_FILE_TYPES = [
	'.html',
	'.htm',
	'.css',
	'.js',
	'.mjs',
	'.cjs',
]

DATA_FILE_TYPES = [
	'.json',
	'.xml',
	'.rss',
	'.atom',
]

FONT_FILE_TYPES = [
	'.ttf',
	'.otf',
	'.eot',
]

filters: {
  minSize: 150,
  fileTypes: [
    ...WEB_FILE_TYPES,
    ...DATA_FILE_TYPES,
    ...FONT_FILE_TYPES,
    '.txt',
    '.svg',
  ],
  include: undefined,
  exclude: undefined,
  pruneCache: true,
}
```

| Option       | Description                                               |
| ------------ | --------------------------------------------------------- |
| `minSize`    | Minimum source file size in bytes.                        |
| `fileTypes`  | File extensions eligible for compression.                 |
| `include`    | Glob patterns specifying files to include.                |
| `exclude`    | Glob patterns specifying files or directories to exclude. |
| `pruneCache` | Remove obsolete cached artifacts and manifest entries.    |

If `fileTypes` is specified, the default types will be overwritten completely.
For easier configuration, The `WEB_FILE_TYPES`, `DATA_FILE_TYPES` and
`FONT_FILE_TYPES` constants can be imported as below.

```ts
// astro.config.ts
import { defineConfig } from 'astro/config'
import { precompressor, WEB_FILE_TYPES, DATA_FILE_TYPES } from 'astro-precompressor'

export default defineConfig({
	integrations: [
		precompressor({
			filters: {
				fileTypes: [...WEB_FILE_TYPES, ...DATA_FILE_TYPES, '.txt'],
			},
		}),
	],
})
```

Include and exclude patterns use
[picomatch](https://github.com/micromatch/picomatch).

Patterns are matched against paths relative to the output directory and use
forward slashes.

For example:

```ts
exclude: ['drafts/**', '**/ignored/**']
```

The first pattern excludes files beneath the root-level `drafts` directory. The
second excludes any directory named `ignored`.

Files are matched in the following order:

1. Any path that doesn't match a resolved `include` pattern is immediately
   skipped
2. Any path that matches a resolved `exclude` pattern is immediately skipped
3. Only files with extensions found in `fileTypes` are included
4. Any included file with a byte size larger then `minSize` is rejected

### Performance

The `performance` option controls concurrent processing and whether compression
results should be retained in the build output. The defaults are below.

```ts
performance: {
  concurrency: availableParallelism(),
  incremental: true,
  discardCompressionIfLarger: true,
}
```

| Option                       | Description                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| `concurrency`                | Maximum number of compression operations running concurrently.                               |
| `incremental`                | Whether to retain cached copies of compressed files for reuse when source file hashes match. |
| `discardCompressionIfLarger` | Whether to discard compressed output when the original is smaller.                           |

The default value for `concurrency` is set automatically based on the number of
logical processors node sees as available. This is usually optimal, but lower
values may use slightly less memory at the expense of speed.

When `incremental` is enabled, compression artifacts are retained in the cache
along with a hash of the source file. While this may marginally slow down
initial builds, subsequent builds will be much faster as long as there are a
large number of unchanged source files. Especially for large sites and
incremental builds, this can shorten build times tremendously. See
[Incremental Caching](#incremental-caching) below for more details.

When `discardCompressionIfLarger` is enabled, each compression algorithm is
evaluated independently. Oversized compression artifacts are retained in the
cache to avoid recompressing the same files on subsequent builds, but are not
copied into the build output.

## Incremental Caching

The integration maintains a cache inside Astro's configured cache directory.

Cached compression artifacts are associated with their source files using
content hashes. When a source file hasn't changed, its cached artifacts can be
reused instead of running the compression engine again.

The cache is maintained independently of the build output, allowing compressed
sidecars to be restored along with their modification timestamps.

With the cache pruning filter option enabled under, obsolete artifacts
associated with files that no longer exist in the output directory can be
cleaned up. See [`filters.pruneCache`](#file-filtering) for more details.

## Output

For each eligible source file, the integration generates one sidecar per enabled
compression algorithm.

For example, given:

```text
dist/
├─ index.html
├─ assets/
│ ├─ scripts.js
│ └─ styles.css
```

The resulting output may look like:

```text
dist/
├─ index.html
├─ index.html.gz
├─ index.html.br
├─ assets/
│ ├─ scripts.js
│ ├─ scripts.js.gz
│ ├─ scripts.js.br
│ ├─ styles.css
│ ├─ styles.css.gz
│ └─ styles.css.br
```

The original files are never modified or replaced.

## Logging

Three levels of logging detail are available:

1. **Summary (`logLevel: 0`):** A concise build summary along with any errors.
2. **Detailed (`logLevel: 1`):** Per-file processing information, cache status,
   compression statistics, and a more detailed summary.
3. **Debug (`logLevel: 2`):** Additional diagnostic messages explaining the
   individual processing steps.

Even when `logLevel` is set to `2`, debug messages will only be shown when the
`--verbose` flag is added to `astro build` script. The default level is `2` to
match Astro's own logging conventions.

> [!TIP] Set this value to 0 if you prefer concise logs.

```ts
logLevel: 0
```

## Build Lifecycle

The integration uses Astro's build lifecycle hooks:

- `astro:config:setup`: Initializes the integration, resolves configuration, and
  prepares the cache. It also waits for `node-zopfli-es` to load if available or
  requested (see [Optional Zopfli](#optional-zopfli)).
- `astro:build:done`: Processes the completed build output and generates
  compressed artifacts.

> [!WARNING] If zopfli is explicitely enabled in your configuration without
> `node-zopfli-es` being installed, your astro build will fail at the setup
> stage.

## Configuring your hosting environment

> [!IMPORTANT] Generating compressed sidecars does not automatically configure
> your hosting environment to serve them. Your web server, CDN, or hosting
> provider must support content negotiation and serve the appropriate sidecar
> when a client advertises support for the algorithm.

### Apache

While MultiViews can be used by disabling Brazilian Portuguese, the more robust
option is to use Apache's `rewrite_module` (`mod_rewrite.c`) to redirect
browsers to the sidecars. Here is a sample `.htaccess` configuration that will
work for most sites with the default options enabled. '.ttf', '.otf', '.eot',

```apacheconf
# SERVE COMPRESSED FILES

## brotli
RewriteCond %{HTTP:Accept-encoding} br
RewriteCond %{REQUEST_URI} \.(html?|css|(c|m)?js|svg|json|xml|rss|atom|txt|ttf|otf|eot)$ [NC]
RewriteCond %{REQUEST_FILENAME}.br -s [NC]
RewriteRule ^(.+) $1.br [QSA]
<FilesMatch "\.(html?|css|(c|m)?js|svg|json|xml|rss|atom|txt|ttf|otf|eot)\.br$">
	### Remove .br Brazilian Portuguese language header to avoid confusion 
	RemoveLanguage .br
	Header append Content-Encoding br
</FilesMatch>

## gzip
RewriteCond %{HTTP:Accept-encoding} gz
RewriteCond %{REQUEST_URI} \.(html?|css|(c|m)?js|svg|json|xml|rss|atom|txt|ttf|otf|eot)$ [NC]
RewriteCond %{REQUEST_FILENAME}.gz -s [NC]
RewriteRule ^(.+) $1.gz [QSA]
<FilesMatch "\.(html?|css|(c|m)?js|svg|json|xml|rss|atom|txt|ttf|otf|eot)\.gz$">
	Header append Content-Encoding gz
</FilesMatch>

## mime types
RewriteRule \.html?\.(br|gz)$ - [T=text/html;charset=UTF-8,E=no-brotli:1,E=no-gzip:1]
RewriteRule \.css\.(br|gz)$ - [T=text/css;charset=UTF-8,E=no-brotli:1,E=no-gzip:1]
RewriteRule \.(c|m)?js\.(br|gz)$  - [T=text/javascript;charset=UTF-8,E=no-brotli:1,E=no-gzip:1]
RewriteRule \.svg\.(br|gz)$ - [T=image/svg+xml;charset=UTF-8,E=no-brotli:1,E=no-gzip:1]
RewriteRule \.json\.(br|gz)$ - [T=application/json;charset=UTF-8,E=no-brotli:1,E=no-gzip:1]
RewriteRule \.xml\.(br|gz)$ - [T=application/xml;charset=UTF-8,E=no-brotli:1,E=no-gzip:1]
RewriteRule \.rss\.(br|gz)$ - [T=application/rss+xml;charset=UTF-8,E=no-brotli:1,E=no-gzip:1]
RewriteRule \.atom\.(br|gz)$ - [T=application/atom+xml;charset=UTF-8,E=no-brotli:1,E=no-gzip:1]
RewriteRule \.txt\.(br|gz)$ - [T=text/plain;charset=UTF-8,E=no-brotli:1,E=no-gzip:1]
RewriteRule \.ttf\.(br|gz)$ - [T=font/ttf,E=no-brotli:1,E=no-gzip:1]
RewriteRule \.otf\.(br|gz)$ - [T=font/otf,E=no-brotli:1,E=no-gzip:1]
RewriteRule \.eot\.(br|gz)$ - [T=application/vnd.ms-fontobject,E=no-brotli:1,E=no-gzip:1]

## cache compressed files separately
<FilesMatch "\.(html?|css|(c|m)?js|svg|json|xml|rss|atom|txt|ttf|otf|eot)\.(br|gz)$">
	Header append Vary Accept-Encoding
</FilesMatch>
```

> [!TIP] Adjust the file types above to match your `astro-precompressor`
> configuration.

> [!WARNING] The `.htaccess` configuration above is representative and does not
> guard against a missing `rewrite_module`. Always test before using it in your
> production environment.

### Nginx

Serving precompressed sidecars requires `ngx_http_gzip_static_module` for gzip,
`ngx_http_brotli_static_module` for Brotli and `ngx_http_zstd_static_module` for
Zstandard. Ensure they are loaded and then enable them in a server location
block.

```nginx
server {
    listen 80;
    server_name example.com;
    root /var/www/html;

    location / {
        brotli_static on;
        zstd_static on;
        gzip_static on;

        # cash precompressed seperately
        gzip_vary on;

        # fallback
        try_files $uri $uri/ =404;
    }
}
```

### Caddy

Simply add the `precompressed` directive inside your `file_server` block.

```caddyfile
example.com {
    root * /var/www/html
    file_server {
        precompressed br zstd gzip
    }
}
```

## License

See the repository [licence](./LICENCE.md) file.
