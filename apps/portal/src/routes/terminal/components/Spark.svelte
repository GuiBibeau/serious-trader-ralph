<script lang="ts">
  // Tiny inline sparkline — a pure function of its values. Rendered by
  // MacroPanel rows and the perp desk's day-P&L venue strip.
  let { values, tone }: { values: number[]; tone: string } = $props();

  const min = $derived(Math.min(...values));
  const max = $derived(Math.max(...values));
  const range = $derived(max - min || 1);
  const last = $derived(values.length - 1 || 1);
</script>

<svg class="spark {tone}" viewBox="0 0 64 20" preserveAspectRatio="none" aria-hidden="true">
  <polyline
    points={values
      .map((v, i) => `${(i / last) * 64},${19 - ((v - min) / range) * 18}`)
      .join(" ")}
  />
</svg>

<style>
  .spark {
    width: 3.4rem;
    height: 1.15rem;
  }

  .spark polyline {
    fill: none;
    stroke: var(--muted);
    stroke-width: 1.3;
    stroke-linejoin: round;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
  }

  /* Tone palette (stroke half of the page's shared tone rules). */
  .spark.up polyline {
    color: #8decc3;
    stroke: var(--up);
  }

  .spark.down polyline {
    color: var(--red);
    stroke: var(--red);
  }

  .spark.warn polyline {
    color: var(--amber);
    stroke: var(--amber);
  }
</style>
