<script lang="ts">
  import "$lib/polyfills";
  import "@trader-ralph/ui/tokens.css";
  import "../styles.css";
  import { injectAnalytics } from "@vercel/analytics/sveltekit";
  import { onMount } from "svelte";
  import { initGeo } from "$lib/geo";

  injectAnalytics();

  onMount(() => {
    initGeo();
  });

  let { children } = $props();
</script>

{@render children()}
