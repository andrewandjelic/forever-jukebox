// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const upload = vi.hoisted(() => ({
  uploadFile: vi.fn(async () => undefined),
  queueUploadFile: vi.fn(async () => undefined),
}));
vi.mock("./upload", () => upload);

const store = vi.hoisted(() => ({ state: { isRunning: false } }));
vi.mock("./store", () => ({ useAppStore: { getState: () => store.state } }));

import { installDropUpload } from "./dropUpload";

function drop(files: File[]) {
  const event = new Event("drop", { cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { types: ["Files"], files } });
  window.dispatchEvent(event);
}

const songs = [new File(["a"], "a.mp3"), new File(["b"], "b.mp3"), new File(["c"], "c.mp3")];

describe("installDropUpload", () => {
  beforeAll(() => {
    installDropUpload();
  });

  beforeEach(() => {
    upload.uploadFile.mockClear();
    upload.queueUploadFile.mockClear();
  });

  it("loads the first song and queues the rest when nothing is playing", () => {
    store.state.isRunning = false;

    drop(songs);

    expect(upload.uploadFile).toHaveBeenCalledWith(songs[0]);
    expect(upload.queueUploadFile.mock.calls).toEqual([[songs[1]], [songs[2]]]);
  });

  it("queues every song while one is playing, leaving playback alone", () => {
    store.state.isRunning = true;

    drop(songs);

    expect(upload.uploadFile).not.toHaveBeenCalled();
    expect(upload.queueUploadFile.mock.calls).toEqual(songs.map((song) => [song]));
  });
});
