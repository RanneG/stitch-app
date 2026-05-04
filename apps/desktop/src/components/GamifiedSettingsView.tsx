import { useEffect, useRef, useState } from "react";
import type { VoiceFaceSettings } from "../fixtures/subscriptions";
import { AppearanceSection } from "./AppearanceSection";
import { FaceVerificationPanel } from "./FaceVerificationPanel";
import { GoogleSignInPanel } from "./GoogleSignInPanel";
import { LinkupRagPanel, type RagVoiceRunRequest } from "./LinkupRagPanel";
import { SettingsPanel } from "./SettingsPanel";
import { VoiceSettingsCard } from "./VoiceSettingsCard";

type TabId = "appearance" | "faceVerification" | "voice" | "alerts" | "billing" | "account";

const TABS: { id: TabId; label: string; emoji: string }[] = [
  { id: "appearance", label: "Appearance", emoji: "🎨" },
  { id: "faceVerification", label: "Face", emoji: "🛡️" },
  { id: "voice", label: "Voice", emoji: "🎙️" },
  { id: "alerts", label: "Alerts", emoji: "🔔" },
  { id: "billing", label: "Billing", emoji: "💳" },
  { id: "account", label: "Account", emoji: "👤" },
];

export type GamifiedSettingsViewProps = {
  settings: VoiceFaceSettings;
  onToggleSetting: <K extends keyof VoiceFaceSettings>(key: K, value: VoiceFaceSettings[K]) => void;
  accountEmailDraft: string;
  onAccountEmailDraftChange: (email: string) => void;
  onAccountEmailCommit: () => void;
  /** Active Google account or saved demo email — drives face enrollment (not the draft field). */
  faceEnrollmentEmail: string;
  onGoogleLinkedEmail: (email: string) => void;
  onAuthSessionChange: () => void;
  /** Increment from parent to switch to Account tab (e.g. account dock). */
  openAccountTabSignal?: number;
  /** Increment from parent to switch to Billing tab (document brain / RAG). */
  openBillingTabSignal?: number;
  /** Increment from parent to switch to Voice tab (e.g. voice navigation). */
  openVoiceTabSignal?: number;
  /** Increment from parent to switch to Alerts tab. */
  openAlertsTabSignal?: number;
  /** Increment from parent to switch to Face tab. */
  openFaceTabSignal?: number;
  /** Increment from parent to switch to Appearance tab. */
  openAppearanceTabSignal?: number;
  /** When id changes, LinkupRagPanel runs this query (Billing tab). */
  ragVoiceRunRequest?: RagVoiceRunRequest | null;
};

export function GamifiedSettingsView({
  settings,
  onToggleSetting,
  accountEmailDraft,
  onAccountEmailDraftChange,
  onAccountEmailCommit,
  faceEnrollmentEmail,
  onGoogleLinkedEmail,
  onAuthSessionChange,
  openAccountTabSignal = 0,
  openBillingTabSignal = 0,
  openVoiceTabSignal = 0,
  openAlertsTabSignal = 0,
  openFaceTabSignal = 0,
  openAppearanceTabSignal = 0,
  ragVoiceRunRequest = null,
}: GamifiedSettingsViewProps) {
  const [tab, setTab] = useState<TabId>("appearance");
  const prevAccountSignal = useRef(0);
  const prevBillingSignal = useRef(0);
  const prevVoiceSignal = useRef(0);
  const prevAlertsSignal = useRef(0);
  const prevFaceSignal = useRef(0);
  const prevAppearanceSignal = useRef(0);

  useEffect(() => {
    if (openAccountTabSignal > prevAccountSignal.current) {
      prevAccountSignal.current = openAccountTabSignal;
      setTab("account");
    }
  }, [openAccountTabSignal]);

  useEffect(() => {
    if (openBillingTabSignal > prevBillingSignal.current) {
      prevBillingSignal.current = openBillingTabSignal;
      setTab("billing");
    }
  }, [openBillingTabSignal]);

  useEffect(() => {
    if (openVoiceTabSignal > prevVoiceSignal.current) {
      prevVoiceSignal.current = openVoiceTabSignal;
      setTab("voice");
    }
  }, [openVoiceTabSignal]);

  useEffect(() => {
    if (openAlertsTabSignal > prevAlertsSignal.current) {
      prevAlertsSignal.current = openAlertsTabSignal;
      setTab("alerts");
    }
  }, [openAlertsTabSignal]);

  useEffect(() => {
    if (openFaceTabSignal > prevFaceSignal.current) {
      prevFaceSignal.current = openFaceTabSignal;
      setTab("faceVerification");
    }
  }, [openFaceTabSignal]);

  useEffect(() => {
    if (openAppearanceTabSignal > prevAppearanceSignal.current) {
      prevAppearanceSignal.current = openAppearanceTabSignal;
      setTab("appearance");
    }
  }, [openAppearanceTabSignal]);

  return (
    <section className="noir-card p-4 md:p-5" aria-label="Settings">
      <p className="font-display text-lg font-bold uppercase tracking-tighter text-stitch-heading">Settings</p>
      <p className="mt-1 font-body text-sm text-stitch-text">Manage settings by section instead of long scrolling.</p>

      <div className="mt-6 grid gap-4 md:grid-cols-[220px_minmax(0,1fr)] md:items-stretch">
        <div className="rounded-sm border border-stitch-border bg-stitch-surface/70 p-3 md:min-h-[24rem]">
          <div className="flex flex-wrap gap-3 overflow-x-auto pb-1 md:h-full md:flex-col md:overflow-visible md:pb-0" role="tablist" aria-label="Settings sections">
            {TABS.filter((t) => t.id !== "account").map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                id={`settings-tab-${t.id}`}
                aria-controls={`settings-panel-${t.id}`}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 rounded-sm border-2 border-black px-4 py-3 text-left font-display text-sm font-bold uppercase tracking-tight transition md:w-full ${
                  tab === t.id
                    ? "bg-stitch-primary-container text-stitch-on-primary-fixed shadow-[4px_4px_0_0_#000] -translate-x-0.5 -translate-y-0.5"
                    : "bg-stitch-topbar text-stitch-text shadow-[2px_2px_0_0_#000] hover:-translate-x-px hover:-translate-y-px hover:shadow-[3px_3px_0_0_#000]"
                }`}
              >
                <span aria-hidden>{t.emoji}</span> {t.label}
              </button>
            ))}
            <button
              type="button"
              role="tab"
              aria-selected={tab === "account"}
              id="settings-tab-account"
              aria-controls="settings-panel-account"
              onClick={() => setTab("account")}
              className={`flex items-center gap-2 rounded-sm border-2 border-black px-4 py-3 text-left font-display text-sm font-bold uppercase tracking-tight transition md:mt-auto md:w-full ${
                tab === "account"
                  ? "bg-stitch-primary-container text-stitch-on-primary-fixed shadow-[4px_4px_0_0_#000] -translate-x-0.5 -translate-y-0.5"
                  : "bg-stitch-topbar text-stitch-text shadow-[2px_2px_0_0_#000] hover:-translate-x-px hover:-translate-y-px hover:shadow-[3px_3px_0_0_#000]"
              }`}
            >
              <span aria-hidden>👤</span> Account
            </button>
          </div>
        </div>

        <div className="min-h-[12rem]">
        {tab === "appearance" ? (
          <div id="settings-panel-appearance" role="tabpanel" aria-labelledby="settings-tab-appearance" className="space-y-4">
            <AppearanceSection />
          </div>
        ) : null}
        {tab === "faceVerification" ? (
          <div id="settings-panel-faceVerification" role="tabpanel" aria-labelledby="settings-tab-faceVerification" className="space-y-4">
            <div className="rounded-lg border border-stitch-border bg-stitch-surface/80 p-3 font-body text-sm text-stitch-text">
              <strong className="text-stitch-heading">Face verification</strong> — enroll once, then approve payments with a quick
              glance. Progress is shown in the panel below.
            </div>
            <FaceVerificationPanel initialEmail={faceEnrollmentEmail} />
          </div>
        ) : null}
        {tab === "voice" ? (
          <div id="settings-panel-voice" role="tabpanel" aria-labelledby="settings-tab-voice" className="space-y-4">
            <div className="rounded-lg border border-stitch-border bg-stitch-surface/80 p-3 font-body text-sm text-stitch-text">
              <strong className="text-stitch-heading">Voice</strong> — hands-free phrases and the one-shot mic check. Pick input/output
              devices here if the level meter or Web Speech is listening on the wrong hardware.
            </div>
            <VoiceSettingsCard settings={settings} onToggleSetting={onToggleSetting} />
          </div>
        ) : null}
        {tab === "alerts" ? (
          <div id="settings-panel-alerts" role="tabpanel" aria-labelledby="settings-tab-alerts" className="space-y-4">
            <div className="rounded-lg border border-stitch-border bg-stitch-surface/80 p-3 font-body text-sm text-stitch-text">
              <strong className="text-stitch-heading">Alerts</strong> — notification channels separate from voice. In-app toasts already
              fire after approvals; configure email and push-style digests here when they ship.
            </div>
            <div className="noir-card-sm p-4">
              <p className="font-body text-sm font-semibold text-stitch-heading">Push &amp; email</p>
              <p className="mt-2 font-body text-sm text-stitch-text">
                In-app toasts already fire after approvals. Push and email digests are on the roadmap.
              </p>
              <p className="mt-3 font-body text-xs font-semibold text-stitch-muted">Coming soon</p>
              <ul className="mt-2 list-inside list-disc font-body text-xs text-stitch-placeholder">
                <li>Weekly savings recap</li>
                <li>Renewal radar digest</li>
              </ul>
            </div>
          </div>
        ) : null}
        {tab === "billing" ? (
          <div id="settings-panel-billing" role="tabpanel" aria-labelledby="settings-tab-billing" className="space-y-4">
            <div className="noir-card-sm p-4 font-body text-sm text-stitch-text">
              <p className="font-semibold text-stitch-heading">Billing</p>
              <p className="mt-1 text-xs text-stitch-muted">Demo billing only — no real charges in this build.</p>
            </div>
            <LinkupRagPanel voiceRunRequest={ragVoiceRunRequest} />
          </div>
        ) : null}
        {tab === "account" ? (
          <div id="settings-panel-account" role="tabpanel" aria-labelledby="settings-tab-account" className="space-y-4">
            <GoogleSignInPanel onLinkedEmail={onGoogleLinkedEmail} onAuthSessionChange={onAuthSessionChange} />
            <SettingsPanel
              settings={settings}
              onToggleSetting={onToggleSetting}
              accountEmailDraft={accountEmailDraft}
              onAccountEmailDraftChange={onAccountEmailDraftChange}
              onAccountEmailCommit={onAccountEmailCommit}
            />
          </div>
        ) : null}
        </div>
      </div>
    </section>
  );
}
