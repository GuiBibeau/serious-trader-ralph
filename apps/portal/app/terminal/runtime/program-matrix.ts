export type RuntimeOperatorProgramMatrixEntry = {
  subjectKey: string;
  displayName: string;
  programFamily: "spot" | "clob" | "perp" | "prediction" | "flash";
  marketLabels: string[];
  currentState: string;
  targetState: string;
  evidenceTarget: string;
  canaryPlan: string;
  disableDrill: string;
  integrationIssueNumber: number;
  terminalIssueNumber: number | null;
  liveSmokeIssueNumber: number | null;
  nextReadyIssueNumbers: number[];
  notes: string;
  adapterKeys: string[];
  supportedModes: string[];
};

const PROGRAM_MATRIX: RuntimeOperatorProgramMatrixEntry[] = [
  {
    subjectKey: "jupiter",
    displayName: "Jupiter",
    programFamily: "spot",
    marketLabels: ["spot"],
    currentState: "broad_live_ready",
    targetState: "broad_live_ready",
    evidenceTarget:
      "Real spot swap receipt plus Trigger lifecycle evidence with fill-or-cancel reconciliation.",
    canaryPlan:
      "Run a tiny-notional SOL/USDC swap and one Trigger order from the operator surface, then persist signatures, fees, and reconciliation output.",
    disableDrill:
      "Disable Jupiter live subject controls and engage the venue kill switch without changing Raydium or Orca posture.",
    integrationIssueNumber: 366,
    terminalIssueNumber: 388,
    liveSmokeIssueNumber: 412,
    nextReadyIssueNumbers: [412],
    notes:
      "Primary bounded live venue and baseline for later venue smoke proofs.",
    adapterKeys: ["jupiter", "helius_sender", "jito_bundle"],
    supportedModes: ["shadow", "paper", "live"],
  },
  {
    subjectKey: "raydium",
    displayName: "Raydium",
    programFamily: "spot",
    marketLabels: ["spot"],
    currentState: "paper_ready",
    targetState: "limited_live_ready",
    evidenceTarget:
      "Dedicated Raydium live swap receipt proving venue-native routing instead of aggregator fallback.",
    canaryPlan:
      "Run one tiny-notional Raydium swap and, if needed, a bounded reverse trade to neutralize inventory.",
    disableDrill:
      "Pause only the Raydium venue path and confirm Jupiter remains available for the same asset pair.",
    integrationIssueNumber: 370,
    terminalIssueNumber: 388,
    liveSmokeIssueNumber: 413,
    nextReadyIssueNumbers: [411, 413],
    notes:
      "Keep live blocked until the shared venue smoke harness is merged and the bounded real swap proof exists.",
    adapterKeys: ["raydium"],
    supportedModes: ["shadow", "paper"],
  },
  {
    subjectKey: "orca",
    displayName: "Orca Whirlpools",
    programFamily: "spot",
    marketLabels: ["spot"],
    currentState: "paper_ready",
    targetState: "limited_live_ready",
    evidenceTarget:
      "Real Orca pool-specific swap evidence with route, pool context, fees, and reconciliation.",
    canaryPlan:
      "Run one tiny-notional Whirlpool swap against an allowlisted pool and capture pool-level route details.",
    disableDrill:
      "Disable Orca independently and verify other spot venues remain enabled for the same deployment.",
    integrationIssueNumber: 371,
    terminalIssueNumber: 388,
    liveSmokeIssueNumber: 414,
    nextReadyIssueNumbers: [411, 414],
    notes:
      "Pool quality and routing proofs remain required before any live allowlist discussion.",
    adapterKeys: ["orca"],
    supportedModes: ["shadow", "paper"],
  },
  {
    subjectKey: "openbook",
    displayName: "OpenBook v2",
    programFamily: "clob",
    marketLabels: ["spot"],
    currentState: "integrated",
    targetState: "limited_live_ready",
    evidenceTarget:
      "Real order-placement evidence with order id, tx signature, bounded lifecycle, and reconciliation.",
    canaryPlan:
      "Use IOC or place-and-cancel behavior so the live proof stays bounded and does not require a maker loop.",
    disableDrill:
      "Engage the OpenBook venue kill switch and confirm routed spot venues remain unaffected.",
    integrationIssueNumber: 369,
    terminalIssueNumber: 388,
    liveSmokeIssueNumber: 415,
    nextReadyIssueNumbers: [411, 415],
    notes:
      "CLOB live proof must distinguish placement success from later fill or cancel outcomes.",
    adapterKeys: ["openbook_v2"],
    supportedModes: ["shadow", "paper"],
  },
  {
    subjectKey: "phoenix",
    displayName: "Phoenix",
    programFamily: "clob",
    marketLabels: ["spot"],
    currentState: "candidate",
    targetState: "limited_live_ready",
    evidenceTarget:
      "Phoenix-specific order-placement proof with any seat prerequisites, lifecycle evidence, and isolated disable drill.",
    canaryPlan:
      "Resume Phoenix only after the deferred terminal slice is complete, then run one bounded IOC or cancelable live order.",
    disableDrill:
      "Pause Phoenix independently from OpenBook and document any seat-related rollback steps.",
    integrationIssueNumber: 368,
    terminalIssueNumber: 392,
    liveSmokeIssueNumber: 416,
    nextReadyIssueNumbers: [392, 405, 411, 416],
    notes:
      "Deferred venue. Keep Phoenix behind the later-phase terminal issue and smoke harness rollout.",
    adapterKeys: ["phoenix_orderbook"],
    supportedModes: ["shadow", "paper"],
  },
  {
    subjectKey: "drift",
    displayName: "Drift",
    programFamily: "perp",
    marketLabels: ["perp"],
    currentState: "integrated",
    targetState: "limited_live_ready",
    evidenceTarget:
      "Real perp position lifecycle evidence covering open, bounded reduce-or-close, margin context, and reconciliation.",
    canaryPlan:
      "Run one tiny-notional live position action from the operator surface, then reduce or close it in the same bounded session.",
    disableDrill:
      "Kill the Drift venue path and verify spot venues and prediction venues remain controllable.",
    integrationIssueNumber: 372,
    terminalIssueNumber: 389,
    liveSmokeIssueNumber: 417,
    nextReadyIssueNumbers: [389, 411, 417],
    notes:
      "Perp live proof must capture position state, margin posture, and fees rather than only tx submission.",
    adapterKeys: ["drift", "drift_swift"],
    supportedModes: ["shadow", "paper"],
  },
  {
    subjectKey: "mango",
    displayName: "Mango v4",
    programFamily: "perp",
    marketLabels: ["spot", "perp"],
    currentState: "integrated",
    targetState: "limited_live_ready",
    evidenceTarget:
      "Real Mango account or order lifecycle evidence showing account-state change plus bounded residual exposure.",
    canaryPlan:
      "Run the smallest live Mango action that proves account-state mutation, then flatten or cancel any residual risk.",
    disableDrill:
      "Disable Mango controls without touching Drift or Jupiter readiness state.",
    integrationIssueNumber: 374,
    terminalIssueNumber: 389,
    liveSmokeIssueNumber: 418,
    nextReadyIssueNumbers: [389, 411, 418],
    notes:
      "Cross-margin venues need account-state reconciliation evidence before any readiness widening.",
    adapterKeys: ["mango"],
    supportedModes: ["shadow", "paper"],
  },
  {
    subjectKey: "jupiter_perps",
    displayName: "Jupiter Perps",
    programFamily: "perp",
    marketLabels: ["perp"],
    currentState: "integrated",
    targetState: "paper_ready",
    evidenceTarget:
      "Position-account replay, paper lifecycle coverage, and reconciliation artifacts that prove the WIP API surface is stable enough for paper use.",
    canaryPlan:
      "No live venue smoke until a direct execution adapter and stable operator controls exist.",
    disableDrill:
      "If enabled for research, disable Jupiter Perps without affecting spot Jupiter execution.",
    integrationIssueNumber: 373,
    terminalIssueNumber: 389,
    liveSmokeIssueNumber: null,
    nextReadyIssueNumbers: [389, 380],
    notes:
      "Research-gated. Treat live discussion as blocked until the API surface is no longer explicitly WIP.",
    adapterKeys: ["jupiter_perps"],
    supportedModes: ["shadow", "paper"],
  },
  {
    subjectKey: "raydium_perps",
    displayName: "Raydium Perps",
    programFamily: "perp",
    marketLabels: ["perp"],
    currentState: "candidate",
    targetState: "integrated",
    evidenceTarget:
      "Confirmed auth model, external dependency health, and account creation behavior for the Orderly-backed path.",
    canaryPlan:
      "No live venue smoke until the venue exits candidate and the external dependency path is operator-controlled.",
    disableDrill:
      "If later enabled, pause the Orderly-backed rail without affecting Drift or Mango.",
    integrationIssueNumber: 375,
    terminalIssueNumber: 389,
    liveSmokeIssueNumber: 419,
    nextReadyIssueNumbers: [380, 411, 419],
    notes:
      "Candidate-only because private auth, venue policy, and external dependency behavior are still unresolved.",
    adapterKeys: ["raydium_perps"],
    supportedModes: ["shadow"],
  },
  {
    subjectKey: "dflow",
    displayName: "DFlow Prediction Markets",
    programFamily: "prediction",
    marketLabels: ["prediction"],
    currentState: "integrated",
    targetState: "limited_live_ready",
    evidenceTarget:
      "Real outcome-token purchase evidence with resulting position state, settlement posture, fees, and reconciliation.",
    canaryPlan:
      "Run one tiny-notional live outcome purchase from the operator surface and preserve or flatten bounded inventory per venue constraints.",
    disableDrill:
      "Disable DFlow independently from perps and spot venues while preserving prediction-market audit history.",
    integrationIssueNumber: 376,
    terminalIssueNumber: 390,
    liveSmokeIssueNumber: 420,
    nextReadyIssueNumbers: [411, 420],
    notes:
      "Prediction-market live scope needs explicit policy review even for tiny-notional venue smokes.",
    adapterKeys: ["dflow"],
    supportedModes: ["shadow", "paper"],
  },
  {
    subjectKey: "drift_bet",
    displayName: "Drift BET",
    programFamily: "prediction",
    marketLabels: ["prediction"],
    currentState: "candidate",
    targetState: "integrated",
    evidenceTarget:
      "Cross-margin prediction-market contract model, account semantics, and operator controls documented well enough to implement safely.",
    canaryPlan:
      "No live venue smoke until a direct venue adapter exists and generic prediction controls prove out on DFlow first.",
    disableDrill:
      "If later enabled, isolate Drift BET from Drift perps controls and evidence.",
    integrationIssueNumber: 378,
    terminalIssueNumber: 390,
    liveSmokeIssueNumber: null,
    nextReadyIssueNumbers: [380],
    notes:
      "Still a candidate expansion of the Drift family, not a live-capable venue path.",
    adapterKeys: ["drift_prediction"],
    supportedModes: ["shadow"],
  },
  {
    subjectKey: "monaco",
    displayName: "Monaco Protocol",
    programFamily: "prediction",
    marketLabels: ["prediction"],
    currentState: "candidate",
    targetState: "integrated",
    evidenceTarget:
      "SDK contract, market discovery, and settlement behavior documented with enough fidelity to implement bounded paper flows.",
    canaryPlan:
      "No live venue smoke until Monaco exits candidate and a direct venue adapter exists.",
    disableDrill:
      "If Monaco is later enabled, keep its controls isolated from DFlow and Drift BET.",
    integrationIssueNumber: 377,
    terminalIssueNumber: 390,
    liveSmokeIssueNumber: null,
    nextReadyIssueNumbers: [380],
    notes:
      "Research-established candidate only; no direct execution path is ready yet.",
    adapterKeys: ["monaco"],
    supportedModes: ["shadow"],
  },
  {
    subjectKey: "flash_liquidity",
    displayName: "Flash Liquidity",
    programFamily: "flash",
    marketLabels: ["flash"],
    currentState: "integrated",
    targetState: "limited_live_ready",
    evidenceTarget:
      "Atomic borrow-and-repay evidence proving bounded real execution without depending on a profit-seeking strategy.",
    canaryPlan:
      "Run one tiny bounded flash transaction on the enabled rail and persist tx, fees, and repayment evidence.",
    disableDrill:
      "Disable flash rails without affecting spot, perps, or prediction venue controls.",
    integrationIssueNumber: 379,
    terminalIssueNumber: null,
    liveSmokeIssueNumber: 421,
    nextReadyIssueNumbers: [411, 421],
    notes:
      "Treat flash liquidity as a reusable substrate with its own real-TX proof requirement.",
    adapterKeys: [],
    supportedModes: [],
  },
];

export const RUNTIME_VENUE_PROGRAM_NEXT_ISSUES = [
  389, 380, 392, 411, 412, 413, 414, 415, 417, 418, 420, 421, 416, 419,
] as const;

export function listRuntimeVenueProgramMatrix(): RuntimeOperatorProgramMatrixEntry[] {
  return PROGRAM_MATRIX.map((entry) => ({
    ...entry,
    marketLabels: [...entry.marketLabels],
    nextReadyIssueNumbers: [...entry.nextReadyIssueNumbers],
    adapterKeys: [...entry.adapterKeys],
    supportedModes: [...entry.supportedModes],
  }));
}
