# astro-precompressor

An Astro integration that precompresses build output using Gzip, Brotli and,
optionally, Zstandard.

[![Tests](https://github.com/jpc-ae/astro-precompressor/actions/workflows/tests.yml/badge.svg)](https://github.com/jpc-ae/astro-precompressor/actions/workflows/tests.yml)

[![Latest](https://img.shields.io/npm/v/astro-precompressor)](https://www.npmjs.com/package/astro-precompressor)
[![License](https://img.shields.io/github/license/jpc-ae/astro-precompressor)](LICENSE)

`astro-precompressor` runs after Astro finishes building your project,
generating compressed sidecar files alongside eligible output files for your
server to use instead of on-the-fly compression. It uses incremental caching to
avoid unnecessary recompression between builds (the main motivation for building
this integration) and supports configurable algorithms, file filtering, and
performance.

> [!IMPORTANT] For this integration to be useful, your hosting environment must
> be set up for serving precompressed sidecars. See
> [Configuring Your Hosting Environment](#configuring-your-hosting-environment)
> for suggestions on how to do this.

## Quick Start

Add the extension to your project with the `astro add` command.

```bash
# npm
npx astro add astro-precompressor

# pnpm
pnpm astro add astro-precompressor

# yarn
yarn astro add astro-precompressor
```

This will install the package, add the integration to your Astro configuration,
and place it at the end of your `integrations` array. The next time you run your
build, you should see compression statistics in your build output.

```bash
 generating precompressed files 
16:40:29   ▶ index.html.gz 185.99 KiB → 65.74 KiB (-64.7%) in 431ms
16:40:29   ▶ index.html.br 185.99 KiB → 36.95 KiB (-80.1%) in 681ms
...
16:40:30 ✓ Completed in 2.31s

16:40:30 [astro-precompressor] Processed 71 source files using 47.47s of combined processing time.
16:40:30 [astro-precompressor] Reused: 0 | Updated: 71 | Generated: 142 (0 discarded)
16:40:30 [astro-precompressor] gzip: 71 generated | 1.74 MiB (-64.2%) | 21.46s combined processing time
16:40:30 [astro-precompressor] brotli: 71 generated | 1.07 MiB (-78.1%) | 26.01s combined processing time
16:40:30 [astro-precompressor] Errors: 0
16:40:30 [astro-precompressor] Done!
```

> [!NOTE] 'combined processing time' refers to the combined processing time of
> all compression tasks. Since these tasks run in parallel, the actual time
> taken for them all to complete will typically be much shorter depending on
> your concurrency value.

## Motivation

While various compression options exist for Astro builds, they either do not
offer caching or are too complicated to configure for common options like file
filtering. They are also either restricted to node's zlib library or require
command-line scripts.

This package aims to be straightforward without sacrificing performance or
flexibility. It offers optional Zopfli for better gzip compression, and is open
to adding other engines on request (please
[open an issue](https://github.com/jpc-ae/astro-precompressor/issues) for any
requests). Faster rebuilds using an incremental cache is the priority.

## Features

- **Sane defaults:** Gzip and Brotli tuned for high compression ratios, with
  incremental caching to avoid redundant processing; Zstandard off but available
  if needed.
- **Highly configurable:** Fine-tune algorithm-specific compression settings,
  performance options, file filtering and cleanup.
- **Optional Zopfli:** Install the `node-zopfli-es` package into your project
  for smaller gzip output.
- **Incremental builds:** Reuse cached compression artifacts when source files
  haven't changed, preserving cached artifact modification timestamps.
- **Detailed filtering:** Specify file extensions, a minimum size, and include
  or exclude paths using glob patterns.
- **Compression size checks:** Discard compressed outputs that are not smaller
  than their originals.
- **Detailed logging:** Choose between a basic summary, per-file statistics
  similar to Astro's build logs, and detailed diagnostic output.
- **Legacy Node.js support:** Install the `zstd-napi` package into your project
  for zstd compression on Node.js versions prior to v22.15.0.

## Manual Installation

```bash
# npm
npm install -D astro-precompressor

# pnpm
pnpm add -D astro-precompressor

# yarn
yarn add -D astro-precompressor
```

### Optional Zopfli

To enable the Zopfli gzip compression engine, install node-zopfli-es as a
development dependency in your Astro project. It will be detected automatically
when the integration initializes.

If installed, Zopfli is automatically used for gzip compression when no custom
gzip options are provided. If Zopfli is explicitly enabled, the package must be
installed in your Astro project or the build will fail. See
[Compression Algorithms](#compression-algorithms) for more details.

```bash
# npm
npm install -D node-zopfli-es

# pnpm
pnpm add -D node-zopfli-es

# yarn
yarn add -D node-zopfli-es
```

> [!TIP] The default zopfli settings used by `astro-precompressor` have been
> tuned for speed without sacrificing compression. If smaller gzip files are a
> priority, installing `node-zopfli-es` alongside `astro-precompressor` is
> highly recommended. See the Gzip section under
> [Algorithms](#compression-algorithms) for more details.

### Usage

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

| Option                     | Default                                                 | Description                                         |
| -------------------------- | ------------------------------------------------------- | --------------------------------------------------- |
| `algorithms`               | Gzip, Brotli enabled; Zstandard disabled                | Compression algorithms and their settings           |
| `filters`                  | Built-in filetypes; 150-byte minimum                    | Files eligible for compression                      |
| `performance`              | System-derived concurrency; incremental caching enabled | Processing, caching, and output behaviour           |
| `logLevel`                 | 2 (diagnostics available)                               | Logging verbosity                                   |
| `failOnError`              | false                                                   | Whether compression errors fail the build           |
| `recompressOnConfigChange` | false                                                   | Whether configuration changes trigger recompression |

Any provided options will be merged with the defaults. For example, `gzip` will
still be enabled with the configuration below.

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

The following sections describe the details of each option.

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

> [!NOTE] The `constants` object used in the algorithm configurations below
> comes from the `node:zlib` package.

#### Gzip

Gzip supports two compression engines:

- **zlib:** The standard Node.js compression implementation.
- **Zopfli:** An optional, more computationally intensive implementation that
  generally produces smaller gzip files. It depends on the `node-zopfli-es`
  package.

When Zopfli is unavailable or disabled, the following zlib options are used to
request the highest compression level supported by the zlib engine.

```ts
gzip: {
  level: constants.Z_BEST_COMPRESSION,
  memLevel: constants.Z_MAX_MEMLEVEL,
}
```

When `node-zopfli-es` is installed in your Astro project, it is automatically
detected and used for gzip compression when no custom gzip options are provided.
Alternatively, Zopfli can be explicitly enabled by providing a Zopfli options
object, in which case the build will fail if the package is missing.

```ts
gzip: {
  zopfli: {
    numiterations: 5,
    blocksplitting: false,
  },
}
```

> [!TIP] While higher `numiterations` can produce smaller file sizes, it does so
> at the expense of speed. In testing representative minified Astro output
> files, setting it to `5` produced files that were identical in size to `15`
> (the engine default) while being three times faster. `blocksplitting` has also
> been turned off for a similar reason. These settings aim to provide producing
> meaningful savings over standard gzip while avoiding the extreme processing
> time associated with higher Zopfli iteration counts. Feel free to experiment
> if maximum gzip compression is a priority for you rather than relying on
> `brotli`.

Even with the `node-zopfli-es` package installed, Zopfli can be explicitly
disabled by providing custom `zlib` compression options or setting
`algorithms.gzip.zopfli` to `false`.

```ts
gzip: {
  zopfli: false,
}
```

or

```ts
gzip: {
  level: 1,
}
```

#### Brotli

The default Brotli options prioritize compression ratio.

```ts
brotli: {
  params: {
    [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
  },
}
```

#### Zstandard

Since Brotli generally achieves better compression ratios than Zstandard for web
assets and has been available in browsers for longer, it is the preferred option
for precompression. Zstandard is instead an attractive middleware option on
server rendered pages where compression speed and resource usage often matter
more.

Since this integration is exclusively for precompressing static assets,
Zstandard is disabled by default. It can, however, be enabled by setting its
property to true or providing a configuration object. The default settings for
`zstd` are below, prioritizing high compression ratios without overly taxing
your system.

```ts
zstd: {
	params: {
		[constants.ZSTD_c_compressionLevel]: 19,
	},
}
```

> [!CAUTION] 19 is the highest standard compression level. Setting this higher
> (20–22) turns on ultra mode which is significantly more compute-intensive. If
> you experiment with these higher levels, consider reducing the
> `performance.concurrency` option to a conservative value, such as 1, and
> monitor memory usage. A machine or build environment with sufficient CPU and
> memory resources, such as a cloud build server, is recommended.

Native Zstandard compression was added in `node` v22.15.0. In projects still
using Astro 5 with an older `node` version, Zstandard output can still be
created by installing the `zstd-napi` package which `astro-precompressor` will
then automatically use as a fallback.

### File Filtering

The `filters` option controls which build output files should be compressed. Its
default options are shown below.

```ts
export const WEB_FILE_TYPES = [
	'.html',
	'.htm',
	'.css',
	'.js',
	'.mjs',
	'.cjs',
]

export const DATA_FILE_TYPES = [
	'.json',
	'.xml',
	'.rss',
	'.atom',
]

export const FONT_FILE_TYPES = [
	'.ttf',
	'.otf',
	'.eot',
]

// ...
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
// ...
```

| Option       | Description                                               |
| ------------ | --------------------------------------------------------- |
| `minSize`    | Minimum source file size in bytes.                        |
| `fileTypes`  | File extensions eligible for compression.                 |
| `include`    | Glob patterns specifying files to include.                |
| `exclude`    | Glob patterns specifying files or directories to exclude. |
| `pruneCache` | Remove obsolete cached artifacts and manifest entries.    |

If `fileTypes` is specified, the default types are replaced completely. For
easier configuration, the `WEB_FILE_TYPES`, `DATA_FILE_TYPES` and
`FONT_FILE_TYPES` constants can be imported as below.

```ts
// astro.config.ts
import { defineConfig } from 'astro/config'
import precompressor from 'astro-precompressor'
import { WEB_FILE_TYPES, DATA_FILE_TYPES } from 'astro-precompressor'

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

1. If include patterns are configured, files that don't match any of them are
   skipped.
2. Files matching an exclude pattern are skipped.
3. Files with extensions not listed in fileTypes are skipped.
4. Files smaller than minSize are skipped.

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

> [!NOTE] `availableParallelism` comes from the `node:os` package

| Option                       | Description                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| `concurrency`                | Maximum number of compression operations running concurrently.                               |
| `incremental`                | Whether to retain cached copies of compressed files for reuse when source file hashes match. |
| `discardCompressionIfLarger` | Whether to discard compressed output when the original is smaller.                           |

The default value for `concurrency` is set automatically based on the number of
logical processors that Node.js reports as available. This provides a sensible
default, but lower values may use less memory at the expense of speed. Feel free
to experiment if you feel the build is stuttering during compression.

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
content hashes, so changes to file contents trigger recompression while
unchanged files can reuse cached results.

The cache is maintained independently of the build output, allowing compressed
sidecars to be restored along with their modification timestamps.

When `filters.pruneCache` is enabled, obsolete artifacts associated with files
that no longer exist in the output directory are removed.

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
2. **Breakdown (`logLevel: 1`):** Per-file processing information, cache status,
   compression statistics, and a more detailed summary.
3. **Diagnostics (`logLevel: 2`):** Additional diagnostic messages explaining
   the individual processing steps.

```ts
logLevel: 2
```

When `logLevel` is set to `2`, debug messages will only be shown when the
`--verbose` flag is added to the `astro build` command; otherwise it produces
the same output as `logLevel: 1`. The default level is `2` to match Astro's own
logging conventions.

> [!TIP] Set this value to 0 if you prefer concise logs.

## Build Lifecycle

The integration uses Astro's build lifecycle hooks:

- `astro:config:setup`: Initializes the integration, resolves configuration, and
  prepares the cache. It also waits for `node-zopfli-es` to load if available or
  requested (see [Optional Zopfli](#optional-zopfli)).
- `astro:build:done`: Processes the completed build output and generates
  compressed artifacts.

> [!WARNING] If zopfli is explicitly enabled in your configuration without
> `node-zopfli-es` being installed, your Astro build will fail at the setup
> stage.

## Configuring Your Hosting Environment

> [!IMPORTANT] Generating compressed sidecars does not automatically configure
> your hosting environment to serve them. Your web server, CDN, or hosting
> provider must support content negotiation and serve the appropriate sidecar
> when a client advertises support for the algorithm.

### Apache

Apache's `rewrite_module` (`mod_rewrite.c`) can be used to redirect browsers to
the sidecars. Here is a sample `.htaccess` configuration that will work for most
sites with the default options enabled. It does not include a section for
Zstandard, since that algorithm is disabled by default.

```apacheconf
# SERVE COMPRESSED FILES

## brotli
RewriteCond %{HTTP:Accept-encoding} \bbr\b(?!\s*;\s*q=0(?:\.0{1,3})?(?=\s*(?:,|$))) [NC]
RewriteCond %{REQUEST_URI} \.(html?|css|(c|m)?js|svg|json|xml|rss|atom|txt|ttf|otf|eot)$ [NC]
RewriteCond %{REQUEST_FILENAME}.br -s [NC]
RewriteRule ^(.+) $1.br
<FilesMatch "\.(html?|css|(c|m)?js|svg|json|xml|rss|atom|txt|ttf|otf|eot)\.br$">
	### Prevent Apache from interpreting .br as a language extension
	RemoveLanguage .br
	Header merge Content-Encoding br
</FilesMatch>

## gzip
RewriteCond %{HTTP:Accept-encoding} \bgzip\b(?!\s*;\s*q=0(?:\.0{1,3})?(?=\s*(?:,|$))) [NC]
RewriteCond %{REQUEST_URI} \.(html?|css|(c|m)?js|svg|json|xml|rss|atom|txt|ttf|otf|eot)$ [NC]
RewriteCond %{REQUEST_FILENAME}.gz -s [NC]
RewriteRule ^(.+) $1.gz
<FilesMatch "\.(html?|css|(c|m)?js|svg|json|xml|rss|atom|txt|ttf|otf|eot)\.gz$">
	Header merge Content-Encoding gzip
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
<FilesMatch "\.(html?|css|(c|m)?js|svg|json|xml|rss|atom|txt|ttf|otf|eot)(\.(br|gz))?$">
	Header merge Vary Accept-Encoding
</FilesMatch>
```

> [!TIP] Adjust the filetypes above to match your `astro-precompressor`
> configuration.

> [!WARNING] The `.htaccess` configuration above is representative and does not
> guard against a missing `mod_rewrite`. It assumes `mod_headers` and `mod_mime`
> are available. The encoding conditions reject explicitly disabled encodings
> (q=0), but do not implement complete quality-value negotiation or wildcard
> handling. Always test with your actual Apache setup and file types before
> using it in a production environment.

### Nginx

Serving precompressed sidecars requires `ngx_http_gzip_static_module` for gzip,
`ngx_http_brotli_static_module` for Brotli and `ngx_http_zstd_static_module` for
Zstandard. Ensure the required algorithm modules are loaded, and then enable
them in a server location block.

```nginx
server {
    listen 80;
    server_name example.com;
    root /var/www/html;

    location / {
        brotli_static on;
        zstd_static on;
        gzip_static on;

        # cache precompressed files separately
        gzip_vary on;

        # fallback
        try_files $uri $uri/ =404;
    }
}
```

> [!IMPORTANT] Zstandard support is not included as standard in many Nginx
> installations. A separately built or third-party module may be required when
> using this algorithm in your environment.

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
