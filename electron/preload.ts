import { contextBridge, ipcRenderer, webUtils } from "electron";
const actions = new Set([
  "study-sources:list",
  "study-sources:prepare",
  "study-sources:save",
  "study-sources:adopt",
  "study-sources:context",
  "study-sources:select",
  "study-sources:remove",
  "study-document:import",
  "study-document:url",
  "providers:list",
  "providers:save",
  "providers:select",
  "providers:delete",
  "providers:models",
  "providers:status",
  "providers:usage",
  "checks:submit",
  "annotations:list",
  "annotations:create",
  "annotations:update",
  "annotations:delete",
  "annotations:restore",
  "annotations:revisions",
  "annotations:search",
  "graph:get",
  "graph:link",
  "graph:suggest",
  "graph:review",
  "graph:position",
  "learning:intake-get",
  "learning:intake-put",
  "planning:start",
  "planning:list",
  "planning:get",
  "planning:resume",
  "planning:retry",
  "planning:cancel",
  "planning:mark-complete",
  "planning:edit-module",
  "planning:review-saved",
  "subject:conversation-get",
  "subject:conversation-delete",
  "subject:conversation-archive",
  "subject:list",
  "subject:get",
  "subject:create",
  "subject:update",
  "subject:archive",
  "subject:conversation-create",
  "subject:branch",
  "subject:transcript",
  "subject:context",
  "subject:search",
  "subject:apply",
  "subject:propose",
  "subject:accept",
  "subject:reject",
  "subject:rollback",
  "subject:curriculum",
  "subject:record-put",
  "subject:record-get",
  "subject:record-list",
  "subject:record-delete",
  "subject:record-revise",
  "subject:dashboard",
  "subject:export",
  "subject:restore",
  "export:html",
  "export:preview",
  "subject:archive-export",
  "subject:archive-import",
  "documents:pdf-url",
  "data:load",
  "data:concepts",
  "data:save",
  "data:export",
  "data:import",
  "data:backup",
  "data:restore",
  "data:restore-confirm",
  "data:restore-cancel",
  "data:restore-ack",
  "library:import",
  "auth:status",
  "auth:connect",
  "auth:disconnect",
  "auth:models",
  "model:send",
  "model:cancel",
  "images:search",
  "structure:fetch",
  "structure:depiction",
  "structure:import",
  "external:open",
  "app:diagnostics",
  "app:zoom",
  "data:search",
  "auth:profiles",
  "auth:create-profile",
  "auth:select-profile",
  "auth:rename-profile",
  "resources:cache",
  "resources:cached",
  "research:search",
  "research:verify",
  "documents:search",
  "chemistry:wasm",
  "chemistry:render",
  "background:run",
  "background:cancel",
  "updates:status",
  "updates:check",
  "updates:download",
  "updates:install",
]);
contextBridge.exposeInMainWorld("studio", {
  platform: process.platform,
  invoke: (action: string, payload: unknown) => {
    if (!actions.has(action))
      return Promise.reject(new Error("Unknown action"));
    return ipcRenderer.invoke("studio:invoke", action, payload);
  },
  onRequestState: (callback: (e: unknown) => void) => {
    const listener = (_event: unknown, data: unknown) => callback(data);
    ipcRenderer.on("studio:request-state", listener);
    return () => ipcRenderer.removeListener("studio:request-state", listener);
  },
  onStream: (callback: (e: unknown) => void) => {
    const listener = (_event: unknown, data: unknown) => callback(data);
    ipcRenderer.on("studio:stream", listener);
    return () => ipcRenderer.removeListener("studio:stream", listener);
  },
  onDataChanged: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("studio:data-changed", listener);
    return () => ipcRenderer.removeListener("studio:data-changed", listener);
  },
  onCloseRequested: (callback: () => Promise<void>) => {
    const listener = () =>
      void callback()
        .then(() => ipcRenderer.invoke("studio:close-result", true))
        .catch(() => ipcRenderer.invoke("studio:close-result", false));
    ipcRenderer.on("studio:close-requested", listener);
    return () => ipcRenderer.removeListener("studio:close-requested", listener);
  },
  importDroppedFiles: (files: File[]) => {
    if (files.length > 8)
      return Promise.reject(new Error("Drop up to eight files."));
    const paths = files.map((file) => webUtils.getPathForFile(file));
    if (paths.some((path) => !path))
      return Promise.reject(
        new Error("Only files dropped from your computer can be imported."),
      );
    return ipcRenderer.invoke("studio:dropped", paths);
  },
});
