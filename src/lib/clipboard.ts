/**
 * Copy text to the clipboard with a safe fallback.
 *
 * The async Clipboard API is unavailable on insecure origins, so callers that
 * must not throw (Copy buttons, etc.) fall back to a hidden textarea +
 * `execCommand("copy")`, the same strategy used by the share control.
 */
export async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const el = document.createElement("textarea");
  el.value = text;
  el.setAttribute("readonly", "");
  el.style.position = "fixed";
  el.style.opacity = "0";
  document.body.appendChild(el);
  el.select();
  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(el);
  }
}