import { describe, expect, test } from "bun:test";
import {
  formatHotkeyChord,
  matchesHotkey,
  resolveTerminalHotkeyProfileId,
  toAriaKeyShortcuts,
} from "../../apps/portal/app/terminal/components/terminal-hotkeys";

describe("portal terminal hotkey helpers", () => {
  test("matches modifier and simple chords", () => {
    expect(
      matchesHotkey(
        {
          key: "k",
          ctrlKey: true,
          metaKey: false,
          altKey: false,
          shiftKey: false,
        },
        "mod+k",
      ),
    ).toBe(true);

    expect(
      matchesHotkey(
        {
          key: "Enter",
          ctrlKey: false,
          metaKey: true,
          altKey: false,
          shiftKey: false,
        },
        "mod+enter",
      ),
    ).toBe(true);

    expect(
      matchesHotkey(
        {
          key: "1",
          ctrlKey: false,
          metaKey: false,
          altKey: true,
          shiftKey: false,
        },
        "alt+1",
      ),
    ).toBe(true);

    expect(
      matchesHotkey(
        {
          key: "r",
          ctrlKey: false,
          metaKey: false,
          altKey: false,
          shiftKey: true,
        },
        "r",
      ),
    ).toBe(false);
  });

  test("formats display labels and resolves profile ids", () => {
    expect(formatHotkeyChord("mod+enter")).toBe("Cmd/Ctrl+Enter");
    expect(formatHotkeyChord("alt+1")).toBe("Alt+1");
    expect(toAriaKeyShortcuts("mod+k")).toBe("Control+K Meta+K");
    expect(toAriaKeyShortcuts("shift+r")).toBe("Shift+R");
    expect(resolveTerminalHotkeyProfileId("precision")).toBe("precision");
    expect(resolveTerminalHotkeyProfileId("unknown")).toBe("standard");
  });
});
