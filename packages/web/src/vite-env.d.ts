/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/**
 * The store configuration file, imported through the Vite alias defined in
 * `vite.config.ts`. It is deliberately typed as `unknown`: nothing may use it directly.
 * `src/config.ts` runs it through `parseStoreConfig` first, so a malformed or rule breaking
 * configuration fails loudly instead of producing a half wrong screen.
 */
declare module '@store-config' {
  const value: unknown;
  export default value;
}
