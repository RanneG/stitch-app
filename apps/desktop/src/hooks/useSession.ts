import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { Message } from "@stitch/shared";
import type { AgentEventEnvelope } from "../agent/protocol";
import { StubAgent } from "../agent/stubAgent";
import {
  loadChicagoMay2024Demo,
  loadChicagoToolReplayDemo,
  type ScriptedDemo,
} from "../fixtures/chicagoMay2024";

type NavView = "current" | "history";

export function useSession() {
  const [demo, setDemo] = useState<ScriptedDemo | null>(null);
  const [displayMessages, setDisplayMessages] = useState<Message[]>([]);
  const [saveStatus, setSaveStatus] = useState<string>("");
  const [stubAgentEnabled, setStubAgentEnabled] = useState(false);
  const [leftNavView, setLeftNavView] = useState<NavView>("current");
  const [itineraryOpen, setItineraryOpen] = useState(false);
  const [savedTripsOpen, setSavedTripsOpen] = useState(false);
  const canLoadDemo = import.meta.env.DEV;

  const stubAgentRef = useRef<StubAgent | null>(null);

  useEffect(() => {
    return () => {
      stubAgentRef.current?.stop();
      stubAgentRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!demo) {
      setDisplayMessages([]);
      return;
    }

    if (!stubAgentEnabled) {
      stubAgentRef.current?.stop();
      // Keep the live transcript when leaving stub mode (replay lives in displayMessages).
      // Only fall back to the fixture when there is nothing to show (e.g. toggled off before deltas).
      setDisplayMessages((prev) => (prev.length > 0 ? prev : demo.messages));
      return;
    }

    const agent = new StubAgent();
    stubAgentRef.current = agent;
    setDisplayMessages([]);
    setSaveStatus("Stub agent replay started.");
    agent.start(demo, (event) => {
      handleAgentEvent(event, setDisplayMessages, setSaveStatus);
    });

    return () => {
      agent.stop();
    };
  }, [demo, stubAgentEnabled]);

  function loadDemo() {
    const loaded = stubAgentEnabled
      ? loadChicagoToolReplayDemo()
      : loadChicagoMay2024Demo();
    setDemo(loaded);
    setLeftNavView("current");
    if (!stubAgentEnabled) {
      setDisplayMessages(loaded.messages);
    }
  }

  function unloadDemo() {
    setDemo(null);
    setDisplayMessages([]);
    setLeftNavView("current");
    setItineraryOpen(false);
    setSavedTripsOpen(false);
  }

  function updateDemo(
    updater: (current: ScriptedDemo | null) => ScriptedDemo | null,
  ) {
    setDemo((current) => updater(current));
  }

  return {
    demo,
    setDemo,
    displayMessages,
    setDisplayMessages,
    saveStatus,
    setSaveStatus,
    stubAgentEnabled,
    setStubAgentEnabled,
    leftNavView,
    setLeftNavView,
    itineraryOpen,
    setItineraryOpen,
    savedTripsOpen,
    setSavedTripsOpen,
    canLoadDemo,
    loadDemo,
    unloadDemo,
    updateDemo,
  };
}

function handleAgentEvent(
  event: AgentEventEnvelope,
  setDisplayMessages: Dispatch<SetStateAction<Message[]>>,
  setSaveStatus: Dispatch<SetStateAction<string>>,
) {
  switch (event.type) {
    case "agent.session.started":
      setDisplayMessages([]);
      setSaveStatus(`Stub agent started (${event.payload.messageCount} messages).`);
      break;
    case "agent.message.delta":
      setDisplayMessages((prev) => [...prev, event.payload.message]);
      break;
    case "agent.session.completed":
      setSaveStatus(`Stub agent replay complete (${event.payload.replayedCount} messages).`);
      break;
    case "agent.error":
      setSaveStatus(`Stub agent error: ${event.payload.message}`);
      break;
  }
}
