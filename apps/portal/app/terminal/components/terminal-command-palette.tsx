"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../cn";
import {
  formatHotkeyChord,
  TERMINAL_HOTKEY_PROFILES,
  type TerminalHotkeyProfileId,
} from "./terminal-hotkeys";

export type TerminalCommandPaletteCommand = {
  id: string;
  title: string;
  description?: string;
  hotkey?: string;
  keywords?: readonly string[];
  disabled?: boolean;
  onSelect: () => void;
};

type TerminalCommandPaletteProps = {
  open: boolean;
  commands: readonly TerminalCommandPaletteCommand[];
  hotkeyProfileId: TerminalHotkeyProfileId;
  onClose: () => void;
  onHotkeyProfileChange: (profileId: TerminalHotkeyProfileId) => void;
};

function filterCommands(
  commands: readonly TerminalCommandPaletteCommand[],
  query: string,
): TerminalCommandPaletteCommand[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [...commands];
  return commands.filter((command) => {
    if (command.title.toLowerCase().includes(trimmed)) return true;
    if (command.description?.toLowerCase().includes(trimmed)) return true;
    if (command.hotkey?.toLowerCase().includes(trimmed)) return true;
    if (
      command.keywords?.some((keyword) =>
        keyword.toLowerCase().includes(trimmed),
      )
    ) {
      return true;
    }
    return false;
  });
}

export function TerminalCommandPalette(props: TerminalCommandPaletteProps) {
  const { open, commands, hotkeyProfileId, onClose, onHotkeyProfileChange } =
    props;
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const filtered = useMemo(
    () => filterCommands(commands, query),
    [commands, query],
  );

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelectedIndex(0);
    window.setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (selectedIndex < filtered.length) return;
    setSelectedIndex(filtered.length > 0 ? filtered.length - 1 : 0);
  }, [filtered.length, open, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((current) =>
          filtered.length < 1 ? 0 : Math.min(filtered.length - 1, current + 1),
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((current) => Math.max(0, current - 1));
        return;
      }
      if (event.key !== "Enter") return;
      const selected = filtered[selectedIndex] ?? null;
      if (!selected || selected.disabled) return;
      event.preventDefault();
      selected.onSelect();
      onClose();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [filtered, onClose, open, selectedIndex]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/70 px-4 pt-[8vh] backdrop-blur-[4px]">
      <button
        aria-label="Close command palette"
        className="absolute inset-0"
        onClick={onClose}
        type="button"
      />
      <div className="relative w-[min(760px,96vw)] rounded-lg border border-border bg-paper shadow-2xl">
        <div className="border-b border-border px-4 py-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="label">COMMAND_PALETTE</p>
            <span className="text-[10px] text-muted">Esc to close</span>
          </div>
          <input
            ref={inputRef}
            className="input-field !py-2.5"
            placeholder="Search actions, panels, or hotkeys"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {Object.values(TERMINAL_HOTKEY_PROFILES).map((profile) => {
              const active = profile.id === hotkeyProfileId;
              return (
                <button
                  key={profile.id}
                  className={cn(
                    "rounded border px-2.5 py-1 text-[10px] uppercase tracking-wider",
                    active
                      ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
                      : "border-border text-muted hover:text-ink",
                  )}
                  onClick={() => onHotkeyProfileChange(profile.id)}
                  type="button"
                >
                  {profile.label}
                </button>
              );
            })}
            <span className="text-[10px] text-muted">
              {TERMINAL_HOTKEY_PROFILES[hotkeyProfileId].description}
            </span>
          </div>
        </div>

        <div className="max-h-[56vh] overflow-y-auto p-2">
          {filtered.length < 1 ? (
            <p className="px-2 py-6 text-center text-xs text-muted">
              No matching commands.
            </p>
          ) : (
            <ul className="space-y-1">
              {filtered.map((command, index) => {
                const selected = index === selectedIndex;
                return (
                  <li key={command.id}>
                    <button
                      className={cn(
                        "flex w-full items-center justify-between rounded-md border px-3 py-2 text-left transition-colors",
                        selected
                          ? "border-emerald-500/50 bg-emerald-500/10"
                          : "border-border hover:border-border/80 hover:bg-surface",
                        command.disabled && "cursor-not-allowed opacity-50",
                      )}
                      onMouseEnter={() => setSelectedIndex(index)}
                      onClick={() => {
                        if (command.disabled) return;
                        command.onSelect();
                        onClose();
                      }}
                      type="button"
                      disabled={command.disabled}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-xs text-ink">
                          {command.title}
                        </span>
                        {command.description ? (
                          <span className="block truncate text-[11px] text-muted">
                            {command.description}
                          </span>
                        ) : null}
                      </span>
                      {command.hotkey ? (
                        <span className="ml-3 shrink-0 rounded border border-border bg-surface px-2 py-0.5 text-[10px] text-muted">
                          {formatHotkeyChord(command.hotkey)}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
