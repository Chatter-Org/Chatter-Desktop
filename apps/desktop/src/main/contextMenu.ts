import { Menu, clipboard, shell, type MenuItemConstructorOptions, type WebContents } from "electron";
import { isUploadUrl } from "./downloads";
import { isWebUrl } from "./origin";

/**
 * The upload behind what the page shows: an inline image is the server's
 * downscaled `.preview.webp` of it, but a copied link should be the original.
 */
function originalUrl(src: string): string {
  return isUploadUrl(src) ? src.replace(/\.preview\.webp(?=$|\?)/, "") : src;
}

/**
 * Electron has no default right-click menu, and the Chatter client draws none
 * of its own, so this is the whole of it: text fields (with spelling fixes),
 * selected text, links, and images, videos and clips.
 */
export function attachContextMenu(contents: WebContents): void {
  contents.on("context-menu", (_event, params) => {
    const items: MenuItemConstructorOptions[] = [];

    if (params.misspelledWord) {
      for (const word of params.dictionarySuggestions.slice(0, 5)) {
        items.push({ label: word, click: () => contents.replaceMisspelling(word) });
      }
      items.push({
        label: "Add to dictionary",
        click: () => contents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      });
      items.push({ type: "separator" });
    }

    if (params.linkURL && isWebUrl(params.linkURL)) {
      items.push(
        { label: "Open link in browser", click: () => void shell.openExternal(params.linkURL) },
        { label: "Copy link", click: () => clipboard.writeText(params.linkURL) },
        { type: "separator" },
      );
    }

    // Images on servers that make uploads sign-in-only are drawn from blob:
    // copies, which have no link worth sharing; they can still be copied.
    const noun = ["image", "video", "audio"].includes(params.mediaType) ? params.mediaType : null;
    const mediaUrl = noun && isWebUrl(params.srcURL) ? originalUrl(params.srcURL) : null;
    if (noun && mediaUrl && mediaUrl !== params.linkURL) {
      items.push(
        { label: `Open ${noun} in browser`, click: () => void shell.openExternal(mediaUrl) },
        { label: `Copy ${noun} link`, click: () => clipboard.writeText(mediaUrl) },
      );
    }
    if (params.mediaType === "image" && params.hasImageContents) {
      items.push({ label: "Copy image", click: () => contents.copyImageAt(params.x, params.y) });
    }
    if (noun) items.push({ type: "separator" });

    if (params.isEditable) {
      items.push(
        { role: "undo", enabled: params.editFlags.canUndo },
        { role: "redo", enabled: params.editFlags.canRedo },
        { type: "separator" },
        { role: "cut", enabled: params.editFlags.canCut },
        { role: "copy", enabled: params.editFlags.canCopy },
        { role: "paste", enabled: params.editFlags.canPaste },
        { role: "selectAll" },
      );
    } else if (params.selectionText.trim()) {
      items.push({ role: "copy" });
    }

    while (items.at(-1)?.type === "separator") items.pop();
    if (items.length) Menu.buildFromTemplate(items).popup();
  });
}
