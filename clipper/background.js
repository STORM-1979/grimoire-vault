/**
 * Service worker — currently just kept alive so chrome treats the
 * extension as well-formed. We could add chrome.contextMenus here
 * for "Save link to vault" right-click action; left as a TODO.
 */
self.addEventListener("install", () => {
  // Nothing to precache — popup loads its own assets on open.
});
