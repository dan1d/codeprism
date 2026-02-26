import { useEffect, useState } from "react";
import { Check, Eye, EyeOff, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { api, type InstanceInfo } from "@/lib/api";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Generic save button with state feedback
// ---------------------------------------------------------------------------

type SaveState = "idle" | "saving" | "saved" | "error";

interface SaveButtonProps {
  state: SaveState;
  onClick: () => void;
  label?: string;
}

function SaveButton({ state, onClick, label = "Save changes" }: SaveButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={state === "saving"}
      className={cn(
        "flex items-center gap-2 px-4 py-2 rounded-md text-xs font-medium transition-all",
        state === "saved"
          ? "bg-success/20 border border-success/30 text-success"
          : state === "error"
          ? "bg-danger/20 border border-danger/30 text-danger"
          : "bg-[#1c2333] border border-[#30363d] text-[#c9d1d9] hover:border-accent/50 hover:text-accent",
        state === "saving" && "opacity-60 cursor-wait",
      )}
    >
      {state === "saved" && <Check size={12} />}
      {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : state === "error" ? "Error" : label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------

interface SectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  danger?: boolean;
}

function Section({ title, description, children, danger }: SectionProps) {
  return (
    <div className={cn("rounded-lg border p-5", danger ? "border-danger/30 bg-danger/5" : "border-[#30363d] bg-[#161b22]")}>
      <div className="mb-4">
        <h2 className={cn("text-sm font-semibold", danger ? "text-danger" : "text-[#e1e4e8]")}>{title}</h2>
        {description && <p className="text-xs text-[#8b949e] mt-0.5">{description}</p>}
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form row
// ---------------------------------------------------------------------------

interface FormRowProps {
  label: string;
  hint?: string;
  children: React.ReactNode;
}

function FormRow({ label, hint, children }: FormRowProps) {
  return (
    <div className="flex items-start justify-between gap-6 py-3 border-b border-[#21262d] last:border-0">
      <div className="min-w-0 flex-shrink-0 w-36">
        <label className="text-xs font-medium text-[#c9d1d9]">{label}</label>
        {hint && <p className="text-[10px] text-[#484f58] mt-0.5 leading-tight">{hint}</p>}
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings page
// ---------------------------------------------------------------------------

interface SettingsPageProps {
  instanceInfo: InstanceInfo | null;
  onUpdate: (info: InstanceInfo) => void;
}

export function SettingsPage({ instanceInfo, onUpdate }: SettingsPageProps) {
  // Company section
  const [companyName, setCompanyName] = useState("");
  const [companySave, setCompanySave] = useState<SaveState>("idle");

  // LLM section
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [llmSave, setLlmSave] = useState<SaveState>("idle");
  const [showApiKey, setShowApiKey] = useState(false);

  // Indexing section
  const [indexingSave, setIndexingSave] = useState<SaveState>("idle");

  // Danger zone
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [clearing, setClearing] = useState(false);

  const handleClearKnowledgeBase = async () => {
    if (deleteConfirm !== "DELETE") return;
    setClearing(true);
    try {
      await api.clearKnowledgeBase();
      toast.success("Knowledge base cleared. Re-index your repositories to rebuild.");
      setDeleteConfirm("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to clear knowledge base");
    } finally {
      setClearing(false);
    }
  };

  useEffect(() => {
    if (instanceInfo) setCompanyName(instanceInfo.companyName);
  }, [instanceInfo]);

  useEffect(() => {
    api.settings().then(setSettings).catch(() => {});
  }, []);

  const saveCompany = async () => {
    setCompanySave("saving");
    try {
      const updated = await api.updateInstanceInfo({ companyName });
      onUpdate(updated);
      setCompanySave("saved");
    } catch {
      setCompanySave("error");
    }
    setTimeout(() => setCompanySave("idle"), 2500);
  };

  const saveLLM = async () => {
    setLlmSave("saving");
    try {
      const payload: Record<string, string> = {
        llm_provider: settings["llm_provider"] ?? "",
        llm_model: settings["llm_model"] ?? "",
      };
      // Only send the key if the user entered a new one (not the masked display value)
      const key = settings["llm_api_key"] ?? "";
      if (key && !key.includes("•")) payload["llm_api_key"] = key;
      await api.updateSettings(payload);
      setLlmSave("saved");
    } catch {
      setLlmSave("error");
    }
    setTimeout(() => setLlmSave("idle"), 2500);
  };

  const saveIndexing = async () => {
    setIndexingSave("saving");
    try {
      await api.updateSettings({
        stale_threshold_days: settings["stale_threshold_days"] ?? "7",
        exclude_patterns: settings["exclude_patterns"] ?? "node_modules,.git,dist",
        auto_reindex_threshold: settings["auto_reindex_threshold"] ?? "5",
      });
      setIndexingSave("saved");
    } catch {
      setIndexingSave("error");
    }
    setTimeout(() => setIndexingSave("idle"), 2500);
  };

  const updateSetting = (key: string, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const LLM_PROVIDERS = [
    { value: "openai", label: "OpenAI" },
    { value: "deepseek", label: "DeepSeek" },
    { value: "anthropic", label: "Anthropic" },
    { value: "gemini", label: "Google Gemini" },
  ];

  return (
    <div className="max-w-2xl">
      <PageHeader title="Settings" subtitle="Configure your codeprism instance" />

      <div className="space-y-4">
        {/* Company */}
        <Section title="Company" description="Identity for this codeprism instance">
          <FormRow label="Company name" hint="Displayed in the sidebar">
            <input
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Acme Inc"
              className="w-full px-3 py-2 rounded-md border border-[#30363d] bg-[#0f1117] text-xs text-[#c9d1d9] placeholder:text-[#484f58] focus:outline-none focus:border-accent/50 transition-colors"
            />
          </FormRow>
          <FormRow label="Plan" hint="Your current plan">
            <span className="inline-flex items-center px-2.5 py-1 rounded text-xs bg-[#1c2333] text-[#8b949e] border border-[#30363d] font-mono">
              {instanceInfo?.plan ?? "self_hosted"}
            </span>
          </FormRow>
          <FormRow label="Instance ID" hint="Unique identifier for this instance">
            <span className="font-mono text-xs text-[#484f58]">{instanceInfo?.instanceId ?? "—"}</span>
          </FormRow>
          <FormRow label="Engine version" hint="">
            <span className="font-mono text-xs text-[#484f58]">v{instanceInfo?.engineVersion ?? "—"}</span>
          </FormRow>
          <div className="mt-4">
            <SaveButton state={companySave} onClick={() => void saveCompany()} />
          </div>
        </Section>

        {/* LLM Provider */}
        <Section title="LLM Provider" description="Used for card enrichment and doc generation at index time">
          <FormRow label="Provider">
            <div className="flex gap-3 flex-wrap">
              {LLM_PROVIDERS.map((p) => (
                <label key={p.value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="llm_provider"
                    value={p.value}
                    checked={(settings["llm_provider"] ?? "") === p.value}
                    onChange={() => updateSetting("llm_provider", p.value)}
                    className="accent-accent"
                  />
                  <span className="text-xs text-[#c9d1d9]">{p.label}</span>
                </label>
              ))}
            </div>
          </FormRow>
          <FormRow label="Model" hint="e.g. deepseek-chat, gpt-4o-mini">
            <input
              value={settings["llm_model"] ?? ""}
              onChange={(e) => updateSetting("llm_model", e.target.value)}
              placeholder="deepseek-chat"
              className="w-full px-3 py-2 rounded-md border border-[#30363d] bg-[#0f1117] text-xs text-[#c9d1d9] placeholder:text-[#484f58] focus:outline-none focus:border-accent/50 transition-colors"
            />
          </FormRow>
          <FormRow label="API key" hint={settings["llm_api_key_configured"] === "true" ? "Key configured — clear to replace" : undefined}>
            <div className="relative">
              <input
                type={showApiKey ? "text" : "password"}
                value={settings["llm_api_key"] ?? ""}
                onChange={(e) => updateSetting("llm_api_key", e.target.value)}
                placeholder="sk-…"
                className="w-full pr-10 px-3 py-2 rounded-md border border-[#30363d] bg-[#0f1117] text-xs text-[#c9d1d9] placeholder:text-[#484f58] focus:outline-none focus:border-accent/50 transition-colors font-mono"
              />
              <button
                type="button"
                onClick={() => setShowApiKey((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#484f58] hover:text-[#8b949e]"
              >
                {showApiKey ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
          </FormRow>
          <div className="mt-4">
            <SaveButton state={llmSave} onClick={() => void saveLLM()} />
          </div>
        </Section>

        {/* Indexing */}
        <Section title="Indexing" description="Control how cards are kept fresh">
          <FormRow label="Staleness window" hint="Days before a card is marked stale">
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1"
                max="365"
                value={settings["stale_threshold_days"] ?? "7"}
                onChange={(e) => updateSetting("stale_threshold_days", e.target.value)}
                className="w-20 px-3 py-2 rounded-md border border-[#30363d] bg-[#0f1117] text-xs text-[#c9d1d9] focus:outline-none focus:border-accent/50 transition-colors font-mono"
              />
              <span className="text-xs text-[#8b949e]">days</span>
            </div>
          </FormRow>
          <FormRow label="Exclude patterns" hint="Comma-separated glob patterns">
            <input
              value={settings["exclude_patterns"] ?? "node_modules,.git,dist"}
              onChange={(e) => updateSetting("exclude_patterns", e.target.value)}
              placeholder="node_modules,.git,dist,*.test.ts"
              className="w-full px-3 py-2 rounded-md border border-[#30363d] bg-[#0f1117] text-xs text-[#c9d1d9] placeholder:text-[#484f58] focus:outline-none focus:border-accent/50 transition-colors font-mono"
            />
          </FormRow>
          <FormRow label="Auto-reindex threshold" hint="Stale card count that triggers a background reindex automatically">
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1"
                max="100"
                value={settings["auto_reindex_threshold"] ?? "5"}
                onChange={(e) => updateSetting("auto_reindex_threshold", e.target.value)}
                className="w-20 px-3 py-2 rounded-md border border-[#30363d] bg-[#0f1117] text-xs text-[#c9d1d9] focus:outline-none focus:border-accent/50 transition-colors"
              />
              <span className="text-xs text-[#8b949e]">stale cards</span>
            </div>
          </FormRow>
          <div className="mt-4">
            <SaveButton state={indexingSave} onClick={() => void saveIndexing()} />
          </div>
        </Section>

        {/* Danger zone */}
        <Section title="Danger Zone" description="Destructive actions — cannot be undone" danger>
          <div className="flex items-start gap-3 mb-4">
            <AlertTriangle size={14} className="text-danger flex-shrink-0 mt-0.5" />
            <p className="text-xs text-[#8b949e]">
              Clearing the knowledge base will delete all cards, flows, and metrics. Your repositories will need to be re-indexed.
            </p>
          </div>
          <div className="space-y-2">
            <label className="block text-xs text-[#8b949e]">
              Type <span className="font-mono text-danger">DELETE</span> to confirm
            </label>
            <div className="flex gap-2">
              <input
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                placeholder="DELETE"
                className="w-32 px-3 py-2 rounded-md border border-danger/30 bg-[#0f1117] text-xs text-[#c9d1d9] placeholder:text-[#484f58] focus:outline-none focus:border-danger/50 transition-colors font-mono"
              />
              <button
                onClick={() => void handleClearKnowledgeBase()}
                disabled={deleteConfirm !== "DELETE" || clearing}
                className="px-4 py-2 rounded-md border border-danger/50 text-xs text-danger hover:bg-danger/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {clearing ? "Clearing..." : "Clear knowledge base"}
              </button>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
