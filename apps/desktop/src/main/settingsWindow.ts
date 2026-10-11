import { app, BrowserWindow, ipcMain, shell, type IpcMainInvokeEvent } from "electron";
import { join } from "node:path";
import type { DesktopAppSettings } from "../contract/bridge";
import { IPC, type DesktopPrefsView } from "../shared/ipc";
import { setStartWithSystem } from "./autostart";
import { engine, logsDir } from "./engineHost";
import { rescanGames } from "./games";
import { isServerUrl } from "./origin";
import { getPrefs, setPrefs, type DesktopPrefs } from "./serverStore";
import { isShellUrl, shellPageUrl } from "./shellPages";
import { checkForUpdatesNow, startUpdater } from "./updater";
import { getMainWindow, showMainWindow } from "./window";

let window: BrowserWindow | null = null;
/** The page in the main window that draws these settings itself, if any. */
let listeningPage: Electron.WebContents | null = null;

function values(): DesktopAppSettings {
  const { startWithSystem, startMinimized, shareGameActivity, extraGames, autoUpdate } = getPrefs();
  return { startWithSystem, startMinimized, shareGameActivity, extraGames, autoUpdate };
}

function view(): DesktopPrefsView {
  return { ...values(), appVersion: app.getVersion() };
}

/** The shell's own pages, or the Chatter page in the main window. */
function trusted(event: IpcMainInvokeEvent | Electron.IpcMainEvent): boolean {
  const url = event.senderFrame?.url;
  return isShellUrl(url) || isServerUrl(url);
}

/**
 * The tray's "Settings…". Chatter draws the desktop settings among its own,
 * as Discord does; the app's window is only for when it can't — signed out,
 * on the server picker, or a server whose client predates them.
 */
export function showSettings(): void {
  const page = getMainWindow()?.webContents;
  if (page && page === listeningPage) {
    showMainWindow();
    page.send(IPC.settingsOpen);
    return;
  }
  if (window && !window.isDestroyed()) {
    window.show();
    window.focus();
    return;
  }
  window = new BrowserWindow({
    width: 560,
    height: 640,
    minWidth: 420,
    minHeight: 420,
    title: "Chatter settings",
    show: false,
    backgroundColor: "#262626",
    webPreferences: { preload: join(__dirname, "../preload/index.js"), sandbox: true, contextIsolation: true },
  });
  window.once("ready-to-show", () => window?.show());
  window.on("closed", () => (window = null));
  void window.loadURL(shellPageUrl("settings"));
}

export function installSettings(): void {
  ipcMain.handle(IPC.settingsGet, (event) => {
    if (isShellUrl(event.senderFrame?.url)) return view();
    return isServerUrl(event.senderFrame?.url) ? values() : null;
  });

  ipcMain.handle(IPC.settingsSet, (event, update: unknown) => {
    const fromShell = isShellUrl(event.senderFrame?.url);
    if (!trusted(event)) return null;
    if (update && typeof update === "object") apply(update as Partial<DesktopPrefs>);
    return fromShell ? view() : values();
  });

  ipcMain.handle(IPC.runningApps, async (event) => {
    if (!trusted(event)) return [];
    const list = (await engine.request("processes.list").catch(() => [])) as { exe: string; name: string }[];
    return list.map(({ exe, name }) => ({ exe, name }));
  });

  ipcMain.handle(IPC.checkForUpdates, (event) => {
    if (trusted(event)) void checkForUpdatesNow();
  });

  ipcMain.handle(IPC.openLogs, (event) => {
    if (trusted(event)) void shell.openPath(logsDir());
  });

  ipcMain.on(IPC.settingsListening, (event, on: unknown) => {
    if (!isServerUrl(event.senderFrame?.url)) return;
    if (on === true) listeningPage = event.sender;
    else if (listeningPage === event.sender) listeningPage = null;
  });
}

/** A page that goes elsewhere stops drawing the settings until it says so again. */
export function forgetSettingsListener(contents: Electron.WebContents): void {
  contents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument && listeningPage === contents) listeningPage = null;
  });
}

function apply(u: Partial<DesktopPrefs>): void {
  const clean: Partial<DesktopPrefs> = {};
  for (const key of ["startWithSystem", "startMinimized", "shareGameActivity", "autoUpdate"] as const) {
    if (typeof u[key] === "boolean") clean[key] = u[key];
  }
  if (Array.isArray(u.extraGames)) {
    clean.extraGames = u.extraGames
      .filter((g) => typeof g?.exe === "string" && typeof g?.name === "string")
      .map((g) => ({ exe: g.exe.slice(0, 260), name: g.name.slice(0, 128) }));
  }
  const prefs = setPrefs(clean);
  if (clean.startWithSystem !== undefined) setStartWithSystem(prefs.startWithSystem);
  if (clean.shareGameActivity !== undefined || clean.extraGames) rescanGames();
  if (clean.autoUpdate) startUpdater();
}
