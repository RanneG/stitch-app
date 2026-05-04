import type { Message } from "@stitch/shared";

/** Static thread to exercise every `MessageBlock` variant in the renderer. */
export const demoMessages: Message[] = [
  {
    id: "msg-user-1",
    sessionId: "sess-demo",
    role: "user",
    createdAt: "2026-04-30T10:42:00.000Z",
    content: [{ type: "text", text: "Show my subscription renewals due this month." }],
  },
  {
    id: "msg-assistant-1",
    sessionId: "sess-demo",
    role: "assistant",
    createdAt: "2026-04-30T10:42:18.000Z",
    content: [
      { type: "tool_status", text: "Scanning upcoming renewals...", phase: "pending" },
      {
        type: "subscription_list",
        items: [
          { id: "sub-netflix", name: "Netflix", amountUsd: 15.99, dueDateIso: "2026-05-01", status: "pending" },
          { id: "sub-spotify", name: "Spotify", amountUsd: 11.99, dueDateIso: "2026-05-05", status: "pending" },
        ],
      },
      {
        type: "payment_ping",
        subscriptionId: "sub-netflix",
        title: "Netflix payment due tomorrow",
        body: "Approve this renewal to prevent service interruption.",
      },
      {
        type: "voice_status",
        listening: true,
        text: "Say 'approve' to confirm Netflix.",
      },
      {
        type: "confirm_buttons",
        prompt: "Approve Netflix $15.99?",
        options: [
          { id: "approve", label: "Approve", variant: "primary" },
          { id: "later", label: "Snooze", variant: "secondary" },
        ],
      },
    ],
  },
];
