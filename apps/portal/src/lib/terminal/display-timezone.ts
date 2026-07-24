// Display timezone preference — clocks and journal/tape stamps only.
// Market data / candle axes stay on exchange time (UTC) unless noted.

export type DisplayTimezoneId = string;

export const DEFAULT_DISPLAY_TIMEZONE: DisplayTimezoneId = "UTC";

/** Curated IANA zones for the settings picker (valid Intl timeZone ids). */
export const DISPLAY_TIMEZONES: { id: DisplayTimezoneId; label: string }[] = [
  { id: "UTC", label: "UTC" },
  { id: "America/New_York", label: "New York (Eastern)" },
  { id: "America/Chicago", label: "Chicago (Central)" },
  { id: "America/Denver", label: "Denver (Mountain)" },
  { id: "America/Los_Angeles", label: "Los Angeles (Pacific)" },
  { id: "America/Toronto", label: "Toronto" },
  { id: "America/Sao_Paulo", label: "São Paulo" },
  { id: "America/Mexico_City", label: "Mexico City" },
  { id: "Europe/London", label: "London" },
  { id: "Europe/Paris", label: "Paris" },
  { id: "Europe/Berlin", label: "Berlin" },
  { id: "Europe/Zurich", label: "Zurich" },
  { id: "Europe/Moscow", label: "Moscow" },
  { id: "Asia/Dubai", label: "Dubai" },
  { id: "Asia/Kolkata", label: "India (IST)" },
  { id: "Asia/Singapore", label: "Singapore" },
  { id: "Asia/Hong_Kong", label: "Hong Kong" },
  { id: "Asia/Shanghai", label: "Shanghai" },
  { id: "Asia/Tokyo", label: "Tokyo" },
  { id: "Asia/Seoul", label: "Seoul" },
  { id: "Australia/Sydney", label: "Sydney" },
  { id: "Pacific/Auckland", label: "Auckland" },
];

const CURATED_IDS = new Set(DISPLAY_TIMEZONES.map((row) => row.id));

export function isValidIanaTimezone(
  value: unknown,
): value is DisplayTimezoneId {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) {
    return false;
  }
  try {
    // Throws RangeError for unknown zones.
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function isDisplayTimezoneId(
  value: unknown,
): value is DisplayTimezoneId {
  return typeof value === "string" && CURATED_IDS.has(value);
}

/** Browser IANA zone when supported; otherwise UTC. */
export function detectBrowserTimezone(): DisplayTimezoneId {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (isValidIanaTimezone(zone)) return zone;
  } catch {
    // ignore
  }
  return DEFAULT_DISPLAY_TIMEZONE;
}

/**
 * Ensure the settings list includes the active zone (e.g. a detected local
 * zone that isn't in the curated set).
 */
export function timezonesForPicker(
  active: DisplayTimezoneId,
): { id: DisplayTimezoneId; label: string }[] {
  if (DISPLAY_TIMEZONES.some((row) => row.id === active)) {
    return DISPLAY_TIMEZONES;
  }
  if (!isValidIanaTimezone(active)) return DISPLAY_TIMEZONES;
  return [
    { id: active, label: `${active.replace(/_/g, " ")} (local)` },
    ...DISPLAY_TIMEZONES,
  ];
}

function partsInZone(
  ms: number,
  timeZone: DisplayTimezoneId,
): Record<string, string> {
  const zone = isValidIanaTimezone(timeZone)
    ? timeZone
    : DEFAULT_DISPLAY_TIMEZONE;
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZoneName: "short",
  });
  const out: Record<string, string> = {};
  for (const part of fmt.formatToParts(new Date(ms))) {
    if (part.type !== "literal") out[part.type] = part.value;
  }
  return out;
}

/** Short zone label for the clock, e.g. "UTC", "EST", "GMT+9". */
export function timezoneAbbrev(
  ms: number,
  timeZone: DisplayTimezoneId,
): string {
  const name = partsInZone(ms, timeZone).timeZoneName;
  if (!name) return timeZone === "UTC" ? "UTC" : timeZone;
  return name;
}

/** Status-line clock: `HH:MM:SS EST`. */
export function formatClockInZone(
  ms: number,
  timeZone: DisplayTimezoneId,
): string {
  const p = partsInZone(ms, timeZone);
  const h = p.hour ?? "00";
  const m = p.minute ?? "00";
  const s = p.second ?? "00";
  const abbr = p.timeZoneName ?? "UTC";
  return `${h}:${m}:${s} ${abbr}`;
}

/** Compact time `HH:MM` in the display zone. */
export function formatTimeHmInZone(
  ms: number,
  timeZone: DisplayTimezoneId,
): string {
  const p = partsInZone(ms, timeZone);
  return `${p.hour ?? "00"}:${p.minute ?? "00"}`;
}

/** Compact `HH:MM:SS` in the display zone (no abbrev). */
export function formatTimeHmsInZone(
  ms: number,
  timeZone: DisplayTimezoneId,
): string {
  const p = partsInZone(ms, timeZone);
  return `${p.hour ?? "00"}:${p.minute ?? "00"}:${p.second ?? "00"}`;
}

/** `MM-DD HH:MM` style stamp for alert history. */
export function formatStampInZone(
  ms: number,
  timeZone: DisplayTimezoneId,
): string {
  const p = partsInZone(ms, timeZone);
  return `${p.month ?? "00"}-${p.day ?? "00"} ${p.hour ?? "00"}:${p.minute ?? "00"}`;
}
