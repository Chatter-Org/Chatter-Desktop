import { BrowserWindow, type WebContents } from "electron";

/**
 * The shortcuts the app menu used to carry. There is no menu any more, so
 * that Alt has nothing to open; editing keys (copy, paste, undo) need none.
 */
export function attachShortcuts(contents: WebContents): void {
  contents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const ctrl = input.control || input.meta;
    const key = input.key.toLowerCase();
    const zoomBy = (step: number) => contents.setZoomLevel(step ? contents.getZoomLevel() + step : 0);
    let action: (() => void) | undefined;
    if (ctrl && key === "r") action = () => (input.shift ? contents.reloadIgnoringCache() : contents.reload());
    else if (ctrl && input.shift && key === "i") action = () => contents.toggleDevTools();
    else if (ctrl && (key === "=" || key === "+")) action = () => zoomBy(0.5);
    else if (ctrl && key === "-") action = () => zoomBy(-0.5);
    else if (ctrl && key === "0") action = () => zoomBy(0);
    else if (key === "f11" && !ctrl && !input.alt && !input.shift) {
      action = () => {
        const window = BrowserWindow.fromWebContents(contents);
        window?.setFullScreen(!window.isFullScreen());
      };
    }
    if (!action) return;
    event.preventDefault();
    action();
  });
}
