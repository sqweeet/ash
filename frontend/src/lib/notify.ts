import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "../backend/notification";
import { getSettings } from "./settings";

// Chimes + OS notifications for agent events. Audio is a plain <audio>
// element; notifications use the native Wails runtime.

type Cue = "done" | "confirm";

const SOUND_SRC: Record<Cue, string> = {
  done: "/sounds/done.mp3",
  confirm: "/sounds/confirm.mp3",
};

const audioCache = new Map<Cue, HTMLAudioElement>();

function play(cue: Cue) {
  let el = audioCache.get(cue);
  if (!el) {
    el = new Audio(SOUND_SRC[cue]);
    el.volume = 0.6;
    audioCache.set(cue, el);
  }
  el.currentTime = 0;
  el.play().catch(() => {
    // autoplay can be blocked until first user gesture — ignore
  });
}

let granted = false;
async function ensureNotifyPermission(): Promise<boolean> {
  if (granted) return true;
  try {
    granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
  } catch {
    granted = false;
  }
  return granted;
}

async function osNotify(title: string, body: string) {
  if (!(await ensureNotifyPermission())) return;
  try {
    await sendNotification({ title, body });
  } catch {
    // ignore — notification backend unavailable
  }
}

/** Fire chime + OS notification for an agent event, gated by settings. */
export function notifyAgentEvent(cue: Cue, title: string, body: string) {
  const s = getSettings().engine;
  if (s.sounds) play(cue);
  if (s.notifications && !document.hasFocus()) osNotify(title, body);
}
