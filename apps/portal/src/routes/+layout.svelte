<script lang="ts">
  import "$lib/polyfills";
  import "@trader-ralph/ui/tokens.css";
  import "../styles.css";
  import { injectAnalytics } from "@vercel/analytics/sveltekit";

  injectAnalytics();

  let { children } = $props();
</script>

{@render children()}
