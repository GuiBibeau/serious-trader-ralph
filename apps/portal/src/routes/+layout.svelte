<script lang="ts">
  import "$lib/polyfills";
  import "../styles.css";

  let { children } = $props();
</script>

{@render children()}
