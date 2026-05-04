import type { MessageBlock } from "@stitch/shared";
import {
  ConfirmButtonsStub,
  PaymentPingStub,
  SubscriptionListStub,
  TextBlockStub,
  ToolStatusStub,
  VoiceStatusStub,
  type MessageBlockAction,
} from "./message-block-stubs";

/**
 * Registry: `MessageBlock.type` → React stub. When you add a union member in
 * `@stitch/shared`, add a branch here and a stub component.
 */
export function MessageBlockRenderer({
  block,
  onAction,
}: {
  block: MessageBlock;
  onAction?: (action: MessageBlockAction) => void;
}) {
  switch (block.type) {
    case "text":
      return <TextBlockStub block={block} />;
    case "tool_status":
      return <ToolStatusStub block={block} />;
    case "subscription_list":
      return <SubscriptionListStub block={block} onAction={onAction} />;
    case "payment_ping":
      return <PaymentPingStub block={block} />;
    case "voice_status":
      return <VoiceStatusStub block={block} />;
    case "confirm_buttons":
      return <ConfirmButtonsStub block={block} onAction={onAction} />;
    default:
      return null;
  }
}
