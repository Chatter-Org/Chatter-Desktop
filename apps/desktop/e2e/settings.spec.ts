import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ensureLoggedIn, launchAt, quit, SERVER, storedUser } from "./chatter";

// The desktop settings live in Chatter's own settings dialog, as a Desktop tab,
// and the app has no menu bar for Alt to open.

test("desktop settings are a tab of Chatter's settings, and there is no menu bar", async () => {
  test.skip(!SERVER || !storedUser("browser_user"), "set CHATTER_E2E_SERVER and register browser_user");
  const { app, profile } = await launchAt([], "browser_user");
  try {
    const page = await app.firstWindow();
    await ensureLoggedIn(page, "browser_user");

    // Real key presses: Playwright's own skip the main process, where both
    // the menu bar and the shortcuts are handled.
    const press = (keyCode: string, modifiers: ("control" | "shift")[] = []) =>
      app.evaluate(({ BrowserWindow }, [keyCode, modifiers]) => {
        const contents = BrowserWindow.getAllWindows()[0]!.webContents;
        contents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
        contents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
      }, [keyCode, modifiers] as const);

    expect(await app.evaluate(({ Menu }) => Menu.getApplicationMenu())).toBeNull();
    await press("Alt");
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isMenuBarVisible())).toBe(false);

    // The menu's shortcuts still work without it.
    const zoom = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.getZoomLevel());
    await press("=", ["control"]);
    await expect.poll(zoom).toBe(0.5);
    await press("0", ["control"]);
    await expect.poll(zoom).toBe(0);

    // What the tray's "Settings…" sends once the page has said it listens.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.send("settings:open"));
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("tab", { name: "Desktop", selected: true })).toBeVisible();
    await expect(dialog.getByText("Chatter Desktop", { exact: false })).toBeVisible();

    // A switch saves to the app's own config.
    const prefs = () => JSON.parse(readFileSync(join(profile, "config.json"), "utf8")).prefs ?? {};
    const before = prefs().shareGameActivity ?? true;
    await dialog.getByText("Show Game Activity").locator("xpath=../..").getByRole("switch").click();
    await expect.poll(() => prefs().shareGameActivity).toBe(!before);
    await dialog.getByText("Show Game Activity").locator("xpath=../..").getByRole("switch").click();
    await expect.poll(() => prefs().shareGameActivity).toBe(before);

    // Opened from the gear, the dialog starts on Input as before.
    await page.keyboard.press("Escape");
    await page.getByLabel("Voice and audio settings").click();
    await expect(dialog.getByRole("tab", { name: "Input", selected: true })).toBeVisible();
    await dialog.getByRole("tab", { name: "Desktop" }).click();

    await dialog.getByRole("button", { name: "Change Server" }).click();
    await expect(page.locator("h1")).toHaveText("Connect to a Chatter server");
  } finally {
    await quit(app);
  }
});
