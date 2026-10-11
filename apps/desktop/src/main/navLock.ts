import { shell, type WebContents } from "electron";
import { isUploadUrl } from "./downloads";
import { isServerUrl, isSignInUrl, isWebUrl } from "./origin";

/**
 * Keep the main window on the Chatter server. Sign-in providers may load in
 * place (they redirect back); every other link opens in the system browser.
 */
export function attachNavigationLock(contents: WebContents): void {
  const guard = (event: { preventDefault(): void }, url: string, isMainFrame: boolean) => {
    if (!isMainFrame || isServerUrl(url) || isSignInUrl(url)) return;
    event.preventDefault();
    if (isWebUrl(url)) void shell.openExternal(url);
  };
  contents.on("will-navigate", (event, url) => guard(event, url, event.isMainFrame));
  // A redirect could otherwise carry the window off the server, with no
  // address bar to show where it went.
  contents.on("will-redirect", (event, url) => guard(event, url, event.isMainFrame));

  contents.setWindowOpenHandler(({ url }) => {
    if (isServerUrl(url)) {
      // A target=_blank link to an upload opens in the browser, which shows or
      // downloads it; other server pages open in place.
      if (isUploadUrl(url)) void shell.openExternal(url);
      else void contents.loadURL(url);
    } else if (isWebUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
}
