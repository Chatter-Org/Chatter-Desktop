import { shell, type Session, type WebContents } from "electron";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { isServerUrl, isWebUrl } from "./origin";

/** A file someone uploaded to the Chatter server. */
export function isUploadUrl(raw: string): boolean {
  return isServerUrl(raw) && new URL(raw).pathname.startsWith("/external/");
}

/**
 * Every download goes to the system browser, as Discord's do; the app never
 * saves a file itself. A web URL is simply opened there. A file the page built
 * (an export, a calendar file) is a blob: or data: URL no browser can open, so
 * its bytes are read out of the page and handed over from a one-time address
 * on this machine that tells the browser to download it.
 */
export function handOffDownloads(session: Session): void {
  session.on("will-download", (event, item, contents) => {
    const url = item.getURL();
    const name = item.getFilename();
    const type = item.getMimeType() || "application/octet-stream";
    event.preventDefault();
    if (isWebUrl(url)) return void shell.openExternal(url);
    readFromPage(contents, url)
      .then((bytes) => serveOnce(bytes, name, type))
      .then((local) => shell.openExternal(local))
      .catch((err) => console.error("[downloads] could not hand off", name, err));
  });
}

/** The bytes behind a blob: or data: URL, read in the page that made it. */
async function readFromPage(contents: WebContents, url: string): Promise<Buffer> {
  // The preload keeps blob: URLs alive for a minute after the page revokes
  // them, which it does the moment it has clicked the link.
  const base64: string = await contents.executeJavaScript(`
    fetch(${JSON.stringify(url)})
      .then((r) => r.blob())
      .then((blob) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      }))
  `);
  return Buffer.from(base64, "base64");
}

/**
 * Serve one file to the browser as a download from an unguessable address on
 * the loopback interface, then stop. Given up after two minutes unclaimed.
 */
function serveOnce(bytes: Buffer, name: string, type: string): Promise<string> {
  const path = `/${randomBytes(16).toString("hex")}/${encodeURIComponent(name)}`;
  const server = createServer((req, res) => {
    if (req.url !== path) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": bytes.length,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "no-store",
    });
    res.end(bytes, () => server.close());
  });
  setTimeout(() => server.close(), 120_000).unref();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      resolve(`http://127.0.0.1:${port}${path}`);
    });
  });
}
