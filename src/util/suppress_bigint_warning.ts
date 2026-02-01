const warningPrefix = "bigint: Failed to load bindings";
const globalKey = "__ralphBigintWarningSuppressed__";

type GlobalFlag = typeof globalThis & Record<string, boolean | undefined>;
const globals = globalThis as GlobalFlag;

if (!globals[globalKey]) {
  globals[globalKey] = true;
  const originalWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].startsWith(warningPrefix)) {
      return;
    }
    originalWarn(...args);
  };
}
