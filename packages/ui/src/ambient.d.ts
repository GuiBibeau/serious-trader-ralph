// Ambient shim so .ts files in this package can import .svelte components.
// SvelteKit projects get this from .svelte-kit/ambient.d.ts; a standalone
// package has to declare it. Matches `declare module '*.svelte'` from
// node_modules/svelte/types/index.d.ts but is loaded unconditionally here.
declare module "*.svelte" {
  import { SvelteComponent } from "svelte";
  const Comp: typeof SvelteComponent;
  export default Comp;
}
