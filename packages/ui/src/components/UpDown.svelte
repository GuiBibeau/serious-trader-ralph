<script lang="ts">
  import { fmtPct } from "../format";

  let { value }: { value: number | null } = $props();
</script>

<span class="chg" class:up={(value ?? 0) >= 0} class:down={(value ?? 0) < 0}>{fmtPct(value)}</span>

<style>
  .up {
    color: var(--up);
  }
  .down {
    color: var(--down);
  }
</style>
