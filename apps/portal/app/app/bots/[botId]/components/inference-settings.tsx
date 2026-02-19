import { AnimatePresence, motion } from "framer-motion";
import { Check, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { BTN_PRIMARY, BTN_SECONDARY } from "../../../../lib";

interface InferenceSettingsProps {
  initialBaseUrl: string;
  initialModel: string;
  saving: boolean;
  pinging: boolean;
  error: string | null;
  onSave: (config: {
    baseUrl: string;
    model: string;
    apiKey?: string;
  }) => Promise<void>;
  onPing: (config: {
    baseUrl: string;
    model: string;
    apiKey?: string;
  }) => Promise<void>;
}

export function InferenceSettings({
  initialBaseUrl,
  initialModel,
  saving,
  pinging,
  error,
  onSave,
  onPing,
}: InferenceSettingsProps) {
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const [model, setModel] = useState(initialModel);
  const [apiKey, setApiKey] = useState("");
  const [pingPassed, setPingPassed] = useState(false);

  useEffect(() => {
    setBaseUrl(initialBaseUrl);
    setModel(initialModel);
    setApiKey("");
    setPingPassed(false);
  }, [initialBaseUrl, initialModel]);

  const runPing = async (): Promise<boolean> => {
    const nextBaseUrl = baseUrl.trim();
    const nextModel = model.trim();
    const nextApiKey = apiKey.trim();
    if (!nextBaseUrl || !nextModel) return false;
    try {
      await onPing({
        baseUrl: nextBaseUrl,
        model: nextModel,
        ...(nextApiKey ? { apiKey: nextApiKey } : {}),
      });
      setPingPassed(true);
      return true;
    } catch {
      setPingPassed(false);
      return false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nextBaseUrl = baseUrl.trim();
    const nextModel = model.trim();
    const nextApiKey = apiKey.trim();
    if (!nextBaseUrl || !nextModel) return;
    const pingOk = await runPing();
    if (!pingOk) return;
    await onSave({
      baseUrl: nextBaseUrl,
      model: nextModel,
      ...(nextApiKey ? { apiKey: nextApiKey } : {}),
    });
    setApiKey("");
  };

  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="provider-base-url"
            className="block text-sm font-medium mb-1"
          >
            Provider Base URL
          </label>
          <input
            id="provider-base-url"
            value={baseUrl}
            onChange={(e) => {
              setBaseUrl(e.target.value);
              setPingPassed(false);
            }}
            className="input"
            placeholder="https://api.z.ai/api/paas/v4"
          />
        </div>
        <div>
          <label
            htmlFor="provider-model"
            className="block text-sm font-medium mb-1"
          >
            Model
          </label>
          <input
            id="provider-model"
            value={model}
            onChange={(e) => {
              setModel(e.target.value);
              setPingPassed(false);
            }}
            className="input"
            placeholder="glm-5"
          />
        </div>
        <div>
          <label
            htmlFor="provider-api-key"
            className="block text-sm font-medium mb-1"
          >
            API Key
          </label>
          <input
            id="provider-api-key"
            type="password"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              setPingPassed(false);
            }}
            className="input"
            placeholder="sk-..."
          />
        </div>
        {error ? (
          <div className="rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        ) : null}
        <div className="flex justify-end gap-2 pt-4">
          <button
            type="button"
            className={BTN_SECONDARY}
            onClick={() => {
              setBaseUrl(initialBaseUrl);
              setModel(initialModel);
              setApiKey("");
            }}
            disabled={saving}
          >
            Reset
          </button>
          <button
            type="button"
            className={`${BTN_SECONDARY} relative min-w-[170px] justify-center pr-9`}
            disabled={saving || pinging || !baseUrl.trim() || !model.trim()}
            onClick={() => {
              void runPing().catch(() => null);
            }}
          >
            <span>Test Connection</span>
            <span className="absolute right-3 inline-flex h-4 w-4 items-center justify-center">
              <AnimatePresence mode="wait" initial={false}>
                {pinging ? (
                  <motion.span
                    key="loading"
                    initial={{ opacity: 0, scale: 0.7 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.7 }}
                    transition={{ duration: 0.16 }}
                  >
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  </motion.span>
                ) : pingPassed ? (
                  <motion.span
                    key="ok"
                    initial={{ opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.6 }}
                    transition={{ type: "spring", stiffness: 480, damping: 28 }}
                  >
                    <Check className="h-4 w-4 text-success" />
                  </motion.span>
                ) : null}
              </AnimatePresence>
            </span>
          </button>
          <button
            type="submit"
            className={BTN_PRIMARY}
            disabled={saving || pinging || !baseUrl.trim() || !model.trim()}
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
