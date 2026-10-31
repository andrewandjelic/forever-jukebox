import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import {
  FolderPermission,
  LibraryAnalysisCache,
  LibraryDirectory,
  LibraryFileHandle,
  isAudioFileName,
  readSidecar,
  scanLibrary,
  sidecarNameFor,
} from "../musicLibrary";
import { MemoryAnalysisCache } from "@/core/infrastructure/cache/analysisCache";
import { createTestAnalysis } from "@/shared/analysis-schema/testData";

vi.mock("@forever-jukebox/shared/audio/renderedTrackCache", () => ({
  clearRenderedTracks: vi.fn(async () => undefined),
  deleteRenderedTracks: vi.fn(async () => undefined),
  evictOldestRenderedTracks: vi.fn(async () => undefined),
  getRenderedTrackBytes: vi.fn(async () => 0),
}));

const analysis = createTestAnalysis();

// Node's Blob/File: jsdom's lack text() and arrayBuffer(), which browsers have.
function blob(parts: unknown[]): Blob {
  return new NodeBlob(parts as ConstructorParameters<typeof NodeBlob>[0]) as unknown as Blob;
}

function file(parts: unknown[], name: string): File {
  return new NodeFile(parts as ConstructorParameters<typeof NodeFile>[0], name) as unknown as File;
}

// In-memory stand-in for a picked folder (FileSystemDirectoryHandle).
class FakeDir implements LibraryDirectory {
  readonly kind = "directory" as const;
  readonly files = new Map<string, Blob>();
  readonly dirs = new Map<string, FakeDir>();
  permission: FolderPermission = "granted";

  constructor(readonly name: string) {}

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<LibraryFileHandle> {
    if (!this.files.has(name)) {
      if (!options?.create) {
        throw new DOMException(`${name} not found`, "NotFoundError");
      }
      this.files.set(name, blob([]));
    }
    return this.fileHandle(name);
  }

  async *values() {
    for (const name of this.files.keys()) {
      yield this.fileHandle(name);
    }
    yield* this.dirs.values();
  }

  async queryPermission() {
    return this.permission;
  }

  subdir(name: string) {
    const dir = new FakeDir(name);
    this.dirs.set(name, dir);
    return dir;
  }

  async text(name: string) {
    return (await this.files.get(name)?.text()) ?? null;
  }

  private fileHandle(name: string): LibraryFileHandle {
    return {
      kind: "file",
      name,
      getFile: async () => file([this.files.get(name) ?? blob([])], name),
      createWritable: async () => {
        const parts: (Blob | string)[] = [];
        return {
          write: async (data: Blob | string) => {
            parts.push(data);
          },
          close: async () => {
            this.files.set(name, blob(parts));
          },
        };
      },
    };
  }
}

function audioFile(name: string, content = "song-bytes") {
  return file([content], name);
}

describe("isAudioFileName", () => {
  it("accepts audio extensions in any case and rejects others", () => {
    expect(isAudioFileName("song.mp3")).toBe(true);
    expect(isAudioFileName("Song.FLAC")).toBe(true);
    expect(isAudioFileName("song.mp3.jukebox.json")).toBe(false);
    expect(isAudioFileName("cover.jpg")).toBe(false);
    expect(isAudioFileName(".mp3")).toBe(false);
  });
});

describe("scanLibrary", () => {
  it("lists songs by title, marks analyzed ones and walks subfolders", async () => {
    const root = new FakeDir("Music");
    root.files.set("b.mp3", audioFile("b.mp3"));
    root.files.set("a.m4a", audioFile("a.m4a"));
    root.files.set(sidecarNameFor("b.mp3"), blob(["{}"]));
    root.files.set("notes.txt", blob(["x"]));
    root.subdir("Album").files.set("c.wav", audioFile("c.wav"));
    root.subdir(".hidden").files.set("d.mp3", audioFile("d.mp3"));

    const songs = await scanLibrary(root);

    expect(songs.map((song) => [song.title, song.folderPath, song.analyzed])).toEqual([
      ["a", "", false],
      ["b", "", true],
      ["c", "Album", false],
    ]);
  });
});

describe("LibraryAnalysisCache", () => {
  it("saves the analysis beside a library song and reads it back", async () => {
    const dir = new FakeDir("Music");
    const audio = audioFile("song.mp3");
    dir.files.set("song.mp3", audio);
    const base = new MemoryAnalysisCache();
    const cache = new LibraryAnalysisCache(base, { dir, audioName: "song.mp3", copyAudio: false }, audio);

    await cache.set("fp", analysis);

    expect(await base.get("fp")).toEqual(analysis);
    const fresh = new LibraryAnalysisCache(
      new MemoryAnalysisCache(),
      { dir, audioName: "song.mp3", copyAudio: false },
      audio,
    );
    expect(await fresh.get("fp")).toEqual(analysis);
  });

  it("ignores a sidecar that belongs to different audio", async () => {
    const dir = new FakeDir("Music");
    const original = audioFile("song.mp3", "original");
    await new LibraryAnalysisCache(
      new MemoryAnalysisCache(),
      { dir, audioName: "song.mp3", copyAudio: false },
      original,
    ).set("fp", analysis);

    expect(await readSidecar(dir, "song.mp3", audioFile("song.mp3", "replaced!"))).toBeNull();
  });

  it("copies a dropped song into the folder with its analysis", async () => {
    const dir = new FakeDir("Music");
    const audio = audioFile("new.mp3");
    const cache = new LibraryAnalysisCache(
      new MemoryAnalysisCache(),
      { dir, audioName: "new.mp3", copyAudio: true },
      audio,
    );

    await cache.set("fp", analysis);

    expect(await dir.text("new.mp3")).toBe("song-bytes");
    expect(await readSidecar(dir, "new.mp3", audio)).toEqual(analysis);
  });

  it("reuses an identical copy and renames around a different song", async () => {
    const dir = new FakeDir("Music");
    dir.files.set("same.mp3", audioFile("same.mp3"));
    dir.files.set("clash.mp3", audioFile("clash.mp3", "someone else"));

    await new LibraryAnalysisCache(
      new MemoryAnalysisCache(),
      { dir, audioName: "same.mp3", copyAudio: true },
      audioFile("same.mp3"),
    ).set("fp1", analysis);
    await new LibraryAnalysisCache(
      new MemoryAnalysisCache(),
      { dir, audioName: "clash.mp3", copyAudio: true },
      audioFile("clash.mp3"),
    ).set("fp2", analysis);

    expect([...dir.files.keys()].sort()).toEqual([
      "clash (2).mp3",
      sidecarNameFor("clash (2).mp3"),
      "clash.mp3",
      "same.mp3",
      sidecarNameFor("same.mp3"),
    ]);
    expect(await dir.text("clash.mp3")).toBe("someone else");
  });

  it("adds an analysis found only in the app cache to the folder", async () => {
    const dir = new FakeDir("Music");
    const audio = audioFile("old.mp3");
    dir.files.set("old.mp3", audio);
    const base = new MemoryAnalysisCache();
    await base.set("fp", analysis);
    const cache = new LibraryAnalysisCache(base, { dir, audioName: "old.mp3", copyAudio: false }, audio);

    expect(await cache.get("fp")).toEqual(analysis);
    await vi.waitFor(async () => {
      expect(await readSidecar(dir, "old.mp3", audio)).toEqual(analysis);
    });
  });

  it("writes nothing to the folder without write access", async () => {
    const dir = new FakeDir("Music");
    dir.permission = "prompt";
    const base = new MemoryAnalysisCache();
    const cache = new LibraryAnalysisCache(
      base,
      { dir, audioName: "new.mp3", copyAudio: true },
      audioFile("new.mp3"),
    );

    await cache.set("fp", analysis);

    expect(dir.files.size).toBe(0);
    expect(await base.get("fp")).toEqual(analysis);
  });
});
