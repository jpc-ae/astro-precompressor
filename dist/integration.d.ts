import type { AstroIntegration } from 'astro';
import type { CompressionOptions, ZopfliModule } from './types.js';
/**
 * Dynamically load zopfli when needed
 */
export declare function loadZopfli(): Promise<ZopfliModule>;
export default function precompressor(userOptions?: CompressionOptions): AstroIntegration;
//# sourceMappingURL=integration.d.ts.map