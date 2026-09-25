/**
 * The room console owns the audio capture and the Gemini connections, so it must never be
 * navigated away from while live. Consoles and the dashboard therefore live in separate,
 * named windows: reopening one focuses it instead of reloading it (which would cut the talk).
 */
export const ADMIN_WINDOW = "linguastream-admin";

function focusOrOpen(url: string, name: string, features?: string) {
  // Opening "" returns the existing window with that name untouched, or a blank new one.
  const w = window.open("", name, features);
  if (!w) {
    window.location.href = url; // popup blocked: fall back to a normal navigation
    return;
  }
  try {
    if (w.location.href === "about:blank") w.location.href = url;
  } catch {
    w.location.href = url;
  }
  w.focus();
}

/** Separate window (not a tab): browsers throttle hidden tabs, which delays captions. */
export const openConsole = (sessionId: string) =>
  focusOrOpen(`/console/${sessionId}`, `linguastream-console-${sessionId}`, "popup,width=1280,height=860");

export const openAdmin = () => focusOrOpen("/admin", ADMIN_WINDOW);
