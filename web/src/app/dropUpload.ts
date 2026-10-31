import { useAppStore } from "./store";
import { queueUploadFile, uploadFile } from "./upload";

// Drop audio files anywhere on the page. With nothing playing, the first file
// loads and plays (the Search tab's "Upload by File" flow); while a song
// plays, every dropped file goes into the playlist instead, uploading and
// analyzing in the background. While a file is dragged over the window,
// body.is-file-dragging shows a full-page drop hint (is-file-queueing words
// it for the playlist case).
export function installDropUpload() {
  // dragenter/dragleave fire for every child element crossed; count depth so
  // the hint doesn't flicker.
  let depth = 0;
  const hasFiles = (event: DragEvent) =>
    event.dataTransfer?.types.includes("Files") ?? false;
  const setDragging = (on: boolean) => {
    document.body.classList.toggle("is-file-dragging", on);
    document.body.classList.toggle(
      "is-file-queueing",
      on && useAppStore.getState().isRunning,
    );
  };

  window.addEventListener("dragenter", (event) => {
    if (!hasFiles(event)) {
      return;
    }
    depth += 1;
    setDragging(true);
  });
  window.addEventListener("dragleave", (event) => {
    if (!hasFiles(event)) {
      return;
    }
    depth = Math.max(0, depth - 1);
    if (depth === 0) {
      setDragging(false);
    }
  });
  window.addEventListener("dragover", (event) => {
    if (hasFiles(event)) {
      // Required for the drop event to fire instead of the browser opening the file.
      event.preventDefault();
    }
  });
  window.addEventListener("drop", (event) => {
    if (!hasFiles(event)) {
      return;
    }
    event.preventDefault();
    depth = 0;
    setDragging(false);
    const files = Array.from(event.dataTransfer?.files ?? []);
    const toQueue = useAppStore.getState().isRunning ? files : files.slice(1);
    if (files.length > 0 && toQueue.length < files.length) {
      void uploadFile(files[0]);
    }
    for (const file of toQueue) {
      void queueUploadFile(file);
    }
  });
}
