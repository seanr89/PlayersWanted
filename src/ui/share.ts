/**
 * Opens WhatsApp (or its share sheet) with a prefilled message. Phones only allow a new window to open during the
 * tap itself, not after waiting for the message to be built, so the window is opened first and sent on afterwards.
 */
export async function openShare(buildUrl: () => Promise<string>): Promise<void> {
  const popup = window.open("about:blank", "_blank");
  try {
    const url = await buildUrl();
    if (popup) {
      popup.opener = null;
      popup.location.href = url;
    } else {
      window.location.href = url;
    }
  } catch (e) {
    popup?.close();
    throw e;
  }
}
