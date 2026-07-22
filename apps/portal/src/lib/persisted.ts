// Writable Svelte store persisted to localStorage: hydrates synchronously at
// creation (module scope → survives client-side navigation), writes through
// on every set, and syncs across tabs via the storage event — a deposit made
// in one tab updates every other tab's state.

import { type Writable, writable } from "svelte/store";

export function persisted<T>(
  key: string,
  initial: T,
  parse: (value: unknown) => T = (value) => value as T,
): Writable<T> {
  let start = initial;
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) start = parse(JSON.parse(raw));
    } catch {
      // corrupted or unavailable storage — fall back to the initial value
    }
  }
  const store = writable<T>(start);
  if (typeof window !== "undefined") {
    let writingSelf = false;
    store.subscribe((value) => {
      writingSelf = true;
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // storage full/unavailable — the in-memory store still works
      }
      writingSelf = false;
    });
    if (typeof window.addEventListener === "function") {
      window.addEventListener("storage", (event) => {
        if (writingSelf || event.key !== key || event.newValue === null) return;
        try {
          store.set(parse(JSON.parse(event.newValue)));
        } catch {
          // another tab wrote something unparseable — ignore
        }
      });
    }
  }
  return store;
}
