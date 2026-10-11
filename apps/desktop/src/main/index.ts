import { app, ipcMain, Menu, session, type IpcMainInvokeEvent } from "electron";
import { IPC, type PreloadRole } from "../shared/ipc";
import { launchedAtLogin } from "./autostart";
import { findDeepLink, openDeepLink, openPendingDeepLink, registerProtocol } from "./deepLinks";
import { installDisplayMediaHandler } from "./displayMedia";
import { handOffDownloads } from "./downloads";
import { engineFeatures, installEngineBridge } from "./engineBridge";
import { engine } from "./engineHost";
import { isServerUrl } from "./origin";
import { installPermissionHandlers } from "./permissions";
import { flushSession, persistCookiesPromptly } from "./persistence";
import { getServerOrigin, normaliseOrigin, probeServer, setServerOrigin } from "./serverStore";
import { isShellUrl } from "./shellPages";
import { startGameDetection } from "./games";
import { getPrefs } from "./serverStore";
import { forgetSettingsListener, installSettings, showSettings } from "./settingsWindow";
import { createTray } from "./tray";
import { checkForUpdatesNow, startUpdater } from "./updater";
import { createMainWindow, getMainWindow, loadHome, markQuitting, showMainWindow, showServerPicker } from "./window";

const APP_ID = "com.chatter.desktop";

// A separate profile (tests, or a second account side by side). Must be set
// before the single-instance lock, which lives in the profile directory.
if (process.env["CHATTER_USER_DATA"]) app.setPath("userData", process.env["CHATTER_USER_DATA"]);

// A second launch hands over to the running instance and exits.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // A deep link opened while we run arrives as the second launch's argv.
  app.on("second-instance", (_event, argv) => {
    const link = findDeepLink(argv);
    if (link) void openDeepLink(link);
    else showMainWindow();
  });
  start();
}

function start(): void {
  // Join, mute and entrance sounds play without a click having happened first.
  app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
  if (process.platform === "win32") app.setAppUserModelId(APP_ID);
  registerProtocol();

  app.whenReady().then(async () => {
    app.userAgentFallback = `${app.userAgentFallback} ChatterDesktop/${app.getVersion()}`;
    persistCookiesPromptly(session.defaultSession);

    // The engine starts first so the page's first load already knows which
    // native features it can offer.
    engine.start();
    installEngineBridge(getMainWindow);
    await engine.ready(3000);

    installPermissionHandlers(session.defaultSession);
    handOffDownloads(session.defaultSession);
    installSettings();
    installDisplayMediaHandler(session.defaultSession, getMainWindow);
    registerIpc();
    // No menu bar, so Alt has nothing to show; its shortcuts live in
    // window.ts and its items in Chatter's own settings.
    Menu.setApplicationMenu(null);

    // Started by the system at sign-in, stay in the tray if asked to.
    const main = createMainWindow({ hidden: launchedAtLogin() && getPrefs().startWithSystem && getPrefs().startMinimized });
    forgetSettingsListener(main.webContents);
    createTray({
      show: showMainWindow,
      settings: showSettings,
      checkForUpdates: () => void checkForUpdatesNow(),
      changeServer: showServerPicker,
      quit: () => app.quit(),
    });
    startGameDetection();
    startUpdater();

    const link = findDeepLink(process.argv);
    if (link) void openDeepLink(link);
    openPendingDeepLink();
  });

  // Quit waits for the engine to stop cleanly, so other apps it turned down
  // get their volume back, and for the sign-in to be on disk.
  let engineStopped = false;
  app.on("before-quit", (event) => {
    markQuitting();
    if (engineStopped) return;
    event.preventDefault();
    void Promise.all([engine.shutdown(), flushSession(session.defaultSession)]).then(() => {
      engineStopped = true;
      app.quit();
    });
  });
  // The window only hides on close, so this fires on Quit alone.
  app.on("window-all-closed", () => app.quit());
}

function fromShell(event: IpcMainInvokeEvent): boolean {
  return isShellUrl(event.senderFrame?.url);
}

function registerIpc(): void {
  ipcMain.on(IPC.preloadRole, (event) => {
    const url = event.senderFrame?.url;
    let role: PreloadRole = { role: null };
    if (isShellUrl(url)) {
      role = { role: "shell" };
    } else if (isServerUrl(url)) {
      role = {
        role: "remote",
        info: {
          bridgeVersion: 1,
          appVersion: app.getVersion(),
          platform: process.platform,
          features: [...engineFeatures(), "desktop-settings"],
        },
      };
    }
    event.returnValue = role;
  });

  ipcMain.on(IPC.remoteFocus, (event) => {
    if (isServerUrl(event.senderFrame?.url)) showMainWindow();
  });

  ipcMain.handle(IPC.getServer, (event) => (fromShell(event) ? getServerOrigin() : null));

  ipcMain.handle(IPC.probeServer, (event, input: unknown) => {
    if (!fromShell(event) || typeof input !== "string") return { ok: false, error: "Not allowed." };
    return probeServer(input);
  });

  ipcMain.handle(IPC.setServer, (event, input: unknown) => {
    if (!fromShell(event) || typeof input !== "string") return;
    const origin = normaliseOrigin(input);
    if (!origin) return;
    setServerOrigin(origin);
    loadHome();
  });

  ipcMain.handle(IPC.retryServer, (event) => {
    if (fromShell(event)) loadHome();
  });

  ipcMain.handle(IPC.changeServer, (event) => {
    if (fromShell(event) || isServerUrl(event.senderFrame?.url)) showServerPicker();
  });
}
