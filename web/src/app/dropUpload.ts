import { uploadFile } from "./upload";

// Drop an audio file anywhere on the page to analyze and play it. Uses the
// same flow as the Search tab's "Upload by File". While a file is dragged
// over the window, body.is-file-dragging shows a full-page drop hint.
export function installDropUpload() {
  // dragenter/dragleave fire for every child element crossed; count depth so
  // the hint doesn't flicker.
  let depth = 0;
  const hasFiles = (event: DragEvent) =>
    event.dataTransfer?.types.includes("Files") ?? false;
  const setDragging = (on: boolean) =>
    document.body.classList.toggle("is-file-dragging", on);

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
    const file = event.dataTransfer?.files[0];
    if (file) {
      void uploadFile(file);
    }
  });
}
