<script lang="ts">
  let { value, label, hint }: { value: string; label: string; hint?: string } = $props();
</script>

<div class="stat">
  <b>{value}</b>
  <span>{label}{#if hint} <em>{hint}</em>{/if}</span>
</div>

<style>
  .stat {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    padding: 0.8rem 0.9rem;
    display: grid;
    gap: 0.2rem;
    box-shadow: var(--shadow-hard);
  }
  .stat b {
    font-family: ui-monospace, monospace;
    font-size: 1.2rem;
    font-variant-numeric: tabular-nums;
  }
  .stat span {
    font-size: 0.74rem;
    color: var(--muted);
  }
  .stat em {
    display: block;
    font-style: normal;
    color: var(--faint);
    font-size: 0.68rem;
    margin-top: 0.1rem;
  }
</style>
