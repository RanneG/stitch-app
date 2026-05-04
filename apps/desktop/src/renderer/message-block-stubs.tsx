import type { ReactNode } from "react";
import type { MessageBlock as MB } from "@stitch/shared";

type TextBlock = Extract<MB, { type: "text" }>;
type ToolStatusBlock = Extract<MB, { type: "tool_status" }>;
type ConfirmBlock = Extract<MB, { type: "confirm_buttons" }>;
type SubscriptionListBlock = Extract<MB, { type: "subscription_list" }>;
type PaymentPingBlock = Extract<MB, { type: "payment_ping" }>;
type VoiceStatusBlock = Extract<MB, { type: "voice_status" }>;

export type MessageBlockAction =
  | {
      type: "approve_subscription";
      payload: SubscriptionListBlock["items"][number];
    }
  | {
      type: "select_option";
      payload: ConfirmBlock["options"][number];
      prompt: string;
    };

function StubFrame({
  title,
  children,
}: {
  title: MB["type"];
  children?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-stitch-secondary/40 bg-stitch-card/90 p-3 shadow-sm ring-1 ring-stitch-neutral/30">
      <p className="font-body text-[10px] font-semibold tracking-wider text-stitch-secondary uppercase">{title}</p>
      {children}
    </div>
  );
}

export function TextBlockStub({ block }: { block: TextBlock }) {
  return (
    <StubFrame title="text">
      <p className="font-body mt-1 text-sm text-stitch-text">{block.text}</p>
    </StubFrame>
  );
}

export function ToolStatusStub({ block }: { block: ToolStatusBlock }) {
  return (
    <StubFrame title="tool_status">
      <p className="font-body mt-1 text-sm text-stitch-secondary">{block.text}</p>
    </StubFrame>
  );
}

export function SubscriptionListStub({
  block,
  onAction,
}: {
  block: SubscriptionListBlock;
  onAction?: (action: MessageBlockAction) => void;
}) {
  return (
    <StubFrame title="subscription_list">
      <ul className="font-body mt-2 space-y-2 text-xs text-stitch-text">
        {block.items.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-3 rounded-xl bg-stitch-neutral/20 p-2">
            <span>
              {item.name} · ${item.amountUsd.toFixed(2)} · {item.dueDateIso}
            </span>
            <button
              type="button"
              onClick={() => onAction?.({ type: "approve_subscription", payload: item })}
              className="rounded-full bg-stitch-action px-3 py-1 font-body text-xs font-semibold text-white"
            >
              Approve
            </button>
          </li>
        ))}
      </ul>
    </StubFrame>
  );
}

export function PaymentPingStub({ block }: { block: PaymentPingBlock }) {
  return (
    <StubFrame title="payment_ping">
      <p className="font-body mt-1 text-sm text-stitch-text">{block.title}</p>
      <p className="font-body mt-1 text-xs text-stitch-secondary">{block.body}</p>
    </StubFrame>
  );
}

export function VoiceStatusStub({ block }: { block: VoiceStatusBlock }) {
  return (
    <StubFrame title="voice_status">
      <p className="font-body mt-1 text-sm text-stitch-text">{block.text}</p>
      <p className="font-body mt-1 text-xs text-stitch-secondary">
        {block.listening ? "Listening for keyword: approve" : "Voice idle"}
      </p>
    </StubFrame>
  );
}

export function ConfirmButtonsStub({
  block,
  onAction,
}: {
  block: ConfirmBlock;
  onAction?: (action: MessageBlockAction) => void;
}) {
  return (
    <StubFrame title="confirm_buttons">
      <p className="font-body mt-1 text-sm text-stitch-text">{block.prompt}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {block.options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onAction?.({ type: "select_option", payload: o, prompt: block.prompt })}
            className={o.variant === "primary" ? "rounded-full bg-stitch-action px-3 py-1 font-body text-xs font-semibold text-white" : "rounded-full bg-stitch-card px-3 py-1 font-body text-xs font-medium text-stitch-heading ring-1 ring-stitch-secondary/50"}
          >
            {o.label}
          </button>
        ))}
      </div>
    </StubFrame>
  );
}
