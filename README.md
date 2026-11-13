# astro-precompressor

An Astro integration that precompresses build output using Gzip, Brotli, and
Zstandard.

`astro-precompressor` runs after Astro finishes building your project,
generating compressed sidecar files alongside eligible output files. It uses
incremental caching to avoid unnecessary recompression between builds (the main
motivation for building this integration) and supports configurable algorithms,
file filtering, and performance.

## Features

- **Sane defaults:** Gzip & Brotli set to maximum compression, with Zstandard
  available if needed.
- **Highly configurable:** Fine-tune algorithm-specific compression settings,
  performance options and file filtering.
- **Optional Zopfli:** Install the `node-zopfli-es` package into your project
  for smaller gzip output.
- **Incremental builds:** Reuse cached compression artifacts when source files
  haven't changed.
- **Detailed filtering:** Specify file extensions and minimum size; include or
  exclude paths using glob patterns.
- **Compression size checks:** Discard compressed outputs that are not smaller
  than their originals.
- **Timestamp preservation:** Preserve cached timestamps for incremental builds.
- **Detailed logging:** Choose between summary, per-file statistics and detailed
  diagnostic output.

## Installation

<details open>
<summary>pnpm</summary>

```bash
pnpm add -D astro-precompressor
```

</details>

<details>
<summary>yarn</summary>

```bash
yarn add -D astro-precompressor
```

</details>

<details>
<summary>bun</summary>

```bash
bun add -d astro-precompressor
```

</details>

<details>
<summary>npm</summary>

```bash
npm install -D astro-precompressor
```

</details>

### Optional Zopfli

If you want to use Zopfli for gzip compression, add the `node-zopfli-es` package
to your install script above

## Usage

Import the integration into your Astro configuration and add it to the
integrations array.

```ts
// astro.config.ts
import { defineConfig } from 'astro/config'
import precompressor from 'astro-precompressor'

export default defineConfig({
	integrations: [precompressor()],
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
		gzip: {},
		brotli: {},
		zstd: false,
	},
	filters: {
		minSize: 150,
		fileTypes: ['.html', '.css', '.js', '.svg', '.txt'],
		include: ['www/**'],
		exclude: ['**/*.env', '**/.*/**'],
		pruneCache: true,
	},
	performance: {
		concurrency: 4,
		discardCompressionIfLarger: true,
	},
	logLevel: 1,
})
```

Any provided options will be merged with the defaults. The following sections
describe the details of each option.

### Compression algorithms

The `algorithms` option controls which compression algorithms are enabled and
their individual settings.

```ts
algorithms: {
  gzip: {
    level: constants.Z_BEST_COMPRESSION,
    memLevel: constants.Z_MAX_MEMLEVEL,
  },
  brotli: {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
    },
  },
  zstd: false,
}
```

Supported algorithms:

| Algorithm | Extension | Description                                                         |
| --------- | --------- | ------------------------------------------------------------------- |
| Gzip      | `.gz`     | Standard Gzip compression using Node.js zlib or, optionally, Zopfli |
| Brotli    | `.br`     | Brotli compression using Node.js zlib                               |
| Zstandard | `.zst`    | Zstandard compression using Node.js zlib                            |

Gzip and Brotli are enabled by default with the options shown above.

Gzip supports two compression engines:

- **zlib:** The standard Node.js compression implementation.
- **Zopfli:** An optional, more computationally intensive implementation that
  generally produces smaller Gzip files. It depends on the `node-zopfli-es`
  package.

Zopfli must be installed separately in your project (see the
[installation
notes](#optional-zopfli)
for details) and enabled through the Gzip configuration either by setting
`zopfli` to `true` or by providing a `Zopfli.Options` object. The default
options prioritize speed, since higher `numiterations` and turning on
`blocksplitting` did not yield better results in testing while slowing the build
down considerably.

```ts
algorithms: {
  gzip: {
    zopfli: {
      numiterations: 5,
      blocksplitting: false,
    },
  }
}
```

Zstandard can be enabled by setting its property to `true` or providing a
`zlib.ZstdOptions` object, but is off by default since it's designed for
on-the-fly speed rather than maximum compression. When set to true, the
compression level is set to 19.

```ts
{
	params: {
		[constants.ZSTD_c_compressionLevel]: 19,
	},
}
```

> [!CAUTION] 19 is the maximum sane limit for parallel compression. If you set
> this higher (ultra levels 20-22), set concurrency to an appropriately
> conservative number (like 1) and make sure you're running it on a beefy server
> to avoid stalling or running out of memory.

### File filtering

The `filters` option controls which build output files should be compressed.

```ts
filters: {
  minSize: 1024,
  fileTypes: ['.html', '.css', '.js'],
  include: ['**/*'],
  exclude: ['**/ignored/**'],
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
results should be retained in the build output.

```ts
performance: {
  concurrency: 4,
  incremental: true,
  discardCompressionIfLarger: true,
}
```

| Option                       | Description                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| `concurrency`                | Maximum number of files processed concurrently.                                              |
| `incremental`                | Whether to retain cached copies of compressed files for reuse when source file hashes match. |
| `discardCompressionIfLarger` | Discard compressed output when its size is greater than or equal to the original file size.  |

The default value for `concurrency` is calculated automatically based on the
number of logical processors available and algorithms running. This is usually
optimal, but lower values may use slightly less memory at the expense of speed.

When `incremental` is enabled, compression artifacts are retained in the cache
along with a hash of the source file. While this may marginally slow down
initial builds, subsequent builds will be much faster as long as there are a
large number of unchanged source files. Especially for large sites and
incremental builds, this can shorten build times tremendously. See below for
more details.

When `discardCompressionIfLarger` is enabled, each compression algorithm is
evaluated independently. Oversized compression artifacts are retained in the
cache to avoid recompressing the same files on subsequent builds, but are not
copied into the build output.

## Incremental caching

The integration maintains a cache inside Astro's configured cache directory.

Cached compression artifacts are associated with their source files using
content hashes. When a source file hasn't changed, its cached artifacts can be
reused instead of running the compression engine again.

The cache is maintained independently of the build output, allowing compressed
sidecars to be restored along with their modification timestamps.

With cache pruning enabled, obsolete artifacts associated with files that no
longer exist in the output directory can be cleaned up.

## Output

For each eligible source file, the integration generates one sidecar per enabled
compression algorithm.

For example, given:

```text
dist/
├─ index.html
├─ assets/
│ ├─ app.js
│ └─ styles.css
```

The resulting output may look like:

```text
dist/
├─ index.html
├─ index.html.gz
├─ index.html.br
├─ assets/
│ ├─ app.js
│ ├─ app.js.gz
│ ├─ app.js.br
│ ├─ styles.css
│ ├─ styles.css.gz
│ └─ styles.css.br
```

The original files are never modified or replaced.

## Logging

The integration provides three levels of logging detail:

1. **Summary (`logLevel: 0`):** A concise build summary along with any errors.
2. **Detailed (`logLevel: 1`):** Per-file processing information, cache status,
   compression statistics, and a more detailed summary.
3. **Debug (`logLevel: 2`):** Additional diagnostic messages explaining the
   individual processing steps.

`logLevel` defaults to level `2` which mirrors Astro's own logging. The
additional debug logs at level 2 will only be shown when the `--verbose` flag is
added to `astro build`. Set this value to 0 if you prefer concise logs.

```ts
logLevel: 0
```

## Build lifecycle

The integration uses Astro's build lifecycle:

- `astro:config:setup`: Initializes the integration, resolves configuration, and
  prepares the cache. It also waits for `node-zopfli-es` to load if gzip is
  enabled with zopfli compression.
- `astro:build:done`: Processes the completed build output and generates
  compressed artifacts.

> [!WARNING] If zopfli is enabled in your configuration without `node-zopfli-es`
> being installed, your astro build will fail at the setup stage.

## Configuring your hosting environment

> [!IMPORTANT] Generating compressed sidecars does not automatically configure
> your hosting environment to serve them. Your web server, CDN, or hosting
> provider must support content negotiation and serve the appropriate sidecar
> when a client advertises support for its compression format.

### Apache

While MultiViews can be used by disabling Brazilian Portuguese, the more robust
option is to use Apache's `rewrite_module` (`mod_rewrite.c`) to redirect
browsers to the sidecars. Here is a sample `.htaccess` configuration that will
work for most sites.

```apacheconf
# SERVE COMPRESSED FILES

## brotli
RewriteCond %{HTTP:Accept-encoding} br
RewriteCond %{REQUEST_URI} \.(html|css|js|cjs|mjs|svg|json|xml|txt)$ [NC]
RewriteCond %{REQUEST_FILENAME}.br -s [NC]
RewriteRule ^(.+) $1.br [QSA]
<FilesMatch "\.(html|css|js|cjs|mjs|svg|json|xml|txt)\.br$">
	### Remove .br Brazilian Portuguese language header to avoid confusion 
	RemoveLanguage .br
	Header append Content-Encoding br
</FilesMatch>

## gzip
RewriteCond %{HTTP:Accept-encoding} gz
RewriteCond %{REQUEST_URI} \.(html|css|js|cjs|mjs|svg|json|xml|txt)$ [NC]
RewriteCond %{REQUEST_FILENAME}.gz -s [NC]
RewriteRule ^(.+) $1.gz [QSA]
<FilesMatch "\.(html|css|js|cjs|mjs|svg|json|xml|txt)\.gz$">
	Header append Content-Encoding gz
</FilesMatch>
## mime types
RewriteRule \.html\.(br|gz)$ - [T=text/html;charset=UTF-8,E=no-brotli:1,E=no-gzip:1]
RewriteRule \.css\.(br|gz)$ - [T=text/css;charset=UTF-8,E=no-brotli:1,E=no-gzip:1]
RewriteRule \.js\.(br|gz)$  - [T=text/javascript;charset=UTF-8,E=no-brotli:1,E=no-gzip:1]
RewriteRule \.cjs\.(br|gz)$  - [T=text/javascript;charset=UTF-8,E=no-brotli:1,E=no-gzip:1]
RewriteRule \.mjs\.(br|gz)$  - [T=text/javascript;charset=UTF-8,E=no-brotli:1,E=no-gzip:1]
RewriteRule \.svg\.(br|gz)$ - [T=image/svg+xml;charset=UTF-8,E=no-brotli:1,E=no-gzip:1]
RewriteRule \.json\.(br|gz)$ - [T=application/json;charset=UTF-8,E=no-brotli:1,E=no-gzip:1]
RewriteRule \.xml\.(br|gz)$ - [T=application/xml;charset=UTF-8,E=no-brotli:1,E=no-gzip:1]
RewriteRule \.txt\.(br|gz)$ - [T=text/plain;charset=UTF-8,E=no-brotli:1,E=no-gzip:1]

## cache compressed files separately
<FilesMatch "\.(html|css|js|cjs|mjs|svg|json|xml|txt)\.(br|gz)$">
	Header append Vary Accept-Encoding
</FilesMatch>
```

> [!TIP] Adjust the file types above to match your `astro-precompressor`
> configuration.

> [!IMPORTANT] The config above is representative and does not guard against a
> missing `rewrite_module`. Always test before using it in your production
> environment.

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
