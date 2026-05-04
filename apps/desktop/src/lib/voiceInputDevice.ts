/** localStorage key — shared by Settings → Voice, bridge STT, and the live voice pill. */
export const STITCH_VOICE_INPUT_DEVICE_LS = "stitch.voiceInputDeviceId";

export const STITCH_VOICE_INPUT_DEVICE_CHANGED = "stitch-voice-input-device-changed";

export function readStitchVoiceInputDeviceId(): string {
  try {
    const v = localStorage.getItem(STITCH_VOICE_INPUT_DEVICE_LS);
    return v && v.trim() ? v.trim() : "";
  } catch {
    return "";
  }
}

export function writeStitchVoiceInputDeviceId(deviceId: string): void {
  try {
    if (deviceId.trim()) localStorage.setItem(STITCH_VOICE_INPUT_DEVICE_LS, deviceId.trim());
    else localStorage.removeItem(STITCH_VOICE_INPUT_DEVICE_LS);
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new CustomEvent(STITCH_VOICE_INPUT_DEVICE_CHANGED));
  } catch {
    /* ignore */
  }
}

/** Readable label for any `MediaDeviceInfo` (mic or speaker). */
export function formatMediaDeviceLabel(d: MediaDeviceInfo): string {
  if (d.label && d.label.trim()) return d.label.trim();
  if (!d.deviceId) return "Unknown device";
  const short = `${d.kind} (${d.deviceId.slice(0, 8)}…)`;
  return short;
}
