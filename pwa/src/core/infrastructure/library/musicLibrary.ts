import { AnalysisCachePort } from "@/core/domain/ports/AnalysisCachePort";
import { AnalysisOutput } from "@/shared/analysis-schema";
import { fnv1a32 } from "@/shared/utils/hash";

// A music folder the user picks (File System Access API). Its songs are listed
// on Home, and each analysis is saved beside its song as
// "<song file>.jukebox.json", so a song is analyzed once even after the
// browser's own cache is cleared.

export const SIDECAR_SUFFIX = ".jukebox.json";
const SIDECAR_FORMAT = "forever-jukebox-analysis";
const SIDECAR_VERSION = 1;
const HEAD_BYTES = 65536;
const MAX_SCAN_DEPTH = 3;
const AUDIO_EXTENSIONS = new Set([
  "mp3", "m4a", "aac", "wav", "flac", "ogg", "oga", "opus", "webm", "weba",
  "aiff", "aif", "wma", "mka", "amr",
]);

const HANDLE_DB_NAME = "forever-jukebox-library";
const HANDLE_STORE_NAME = "handles";
const HANDLE_KEY = "musicFolder";

export type FolderPermission = "granted" | "denied" | "prompt";

// The File System Access members used here; lib.dom lacks the picker,
// permission and async-iteration ones.
export type LibraryWritable = {
  write: (data: Blob | string) => Promise<void>;
  close: () => Promise<void>;
};

export type LibraryFileHandle = {
  kind: "file";
  name: string;
  getFile: () => Promise<File>;
  createWritable: () => Promise<LibraryWritable>;
};

export type LibraryDirectory = {
  kind: "directory";
  name: string;
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<LibraryFileHandle>;
  values: () => AsyncIterable<LibraryFileHandle | LibraryDirectory>;
  queryPermission?: (descriptor: { mode: "readwrite" }) => Promise<FolderPermission>;
  requestPermission?: (descriptor: { mode: "readwrite" }) => Promise<FolderPermission>;
};

export type LibrarySong = {
  name: string;
  // Folder path relative to the music folder ("" at its top level).
  folderPath: string;
  title: string;
  analyzed: boolean;
  fileHandle: LibraryFileHandle;
  dir: LibraryDirectory;
};

// Where a song's analysis is saved. copyAudio is set for songs added from
// outside the folder: the audio is copied in beside its analysis.
export type LibraryTarget = {
  dir: LibraryDirectory;
  audioName: string;
  copyAudio: boolean;
};

type SidecarFile = {
  format: typeof SIDECAR_FORMAT;
  version: number;
  audio: AudioKey & { name: string };
  savedAt: string;
  analysis: AnalysisOutput;
};

type AudioKey = {
  size: number;
  headHash: string;
};

export function isMusicLibrarySupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export function isAudioFileName(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot > 0 && AUDIO_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

export function sidecarNameFor(audioName: string): string {
  return `${audioName}${SIDECAR_SUFFIX}`;
}

function titleFromFileName(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

// Content-based, so a sidecar still matches its song after a copy or move
// (unlike the cache fingerprint, which includes the name and modified time).
export async function computeAudioKey(file: Blob): Promise<AudioKey> {
  const head = file.slice(0, HEAD_BYTES);
  const buffer = typeof head.arrayBuffer === "function"
    ? await head.arrayBuffer()
    : await new Response(head).arrayBuffer();
  return { size: file.size, headHash: fnv1a32(buffer) };
}

async function readText(file: Blob): Promise<string> {
  return typeof file.text === "function" ? file.text() : new Response(file).text();
}

async function tryGetFile(dir: LibraryDirectory, name: string): Promise<File | null> {
  try {
    const handle = await dir.getFileHandle(name);
    return await handle.getFile();
  } catch {
    return null;
  }
}

async function writeFile(dir: LibraryDirectory, name: string, data: Blob | string) {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(data);
  await writable.close();
}

export async function scanLibrary(root: LibraryDirectory): Promise<LibrarySong[]> {
  const songs: LibrarySong[] = [];
  const walk = async (dir: LibraryDirectory, folderPath: string, depth: number) => {
    const audioHandles: LibraryFileHandle[] = [];
    const sidecars = new Set<string>();
    const subdirs: LibraryDirectory[] = [];
    for await (const handle of dir.values()) {
      if (handle.name.startsWith(".")) {
        continue;
      }
      if (handle.kind === "directory") {
        subdirs.push(handle);
      } else if (handle.name.endsWith(SIDECAR_SUFFIX)) {
        sidecars.add(handle.name);
      } else if (isAudioFileName(handle.name)) {
        audioHandles.push(handle);
      }
    }
    for (const fileHandle of audioHandles) {
      songs.push({
        name: fileHandle.name,
        folderPath,
        title: titleFromFileName(fileHandle.name),
        analyzed: sidecars.has(sidecarNameFor(fileHandle.name)),
        fileHandle,
        dir,
      });
    }
    if (depth < MAX_SCAN_DEPTH) {
      for (const subdir of subdirs) {
        const childPath = folderPath ? `${folderPath}/${subdir.name}` : subdir.name;
        await walk(subdir, childPath, depth + 1);
      }
    }
  };
  await walk(root, "", 0);
  return songs.sort(
    (a, b) =>
      a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) ||
      a.folderPath.localeCompare(b.folderPath, undefined, { sensitivity: "base" }),
  );
}

export async function readSidecar(
  dir: LibraryDirectory,
  audioName: string,
  audio: Blob,
): Promise<AnalysisOutput | null> {
  const sidecar = await tryGetFile(dir, sidecarNameFor(audioName));
  if (!sidecar) {
    return null;
  }
  try {
    const parsed = JSON.parse(await readText(sidecar)) as Partial<SidecarFile>;
    if (parsed.format !== SIDECAR_FORMAT || !parsed.analysis || !parsed.audio) {
      return null;
    }
    // A sidecar left behind by a different file of the same name is ignored.
    const key = await computeAudioKey(audio);
    if (parsed.audio.size !== key.size || parsed.audio.headHash !== key.headHash) {
      return null;
    }
    return parsed.analysis;
  } catch {
    return null;
  }
}

async function writeSidecar(
  dir: LibraryDirectory,
  audioName: string,
  audio: Blob,
  analysis: AnalysisOutput,
) {
  const sidecar: SidecarFile = {
    format: SIDECAR_FORMAT,
    version: SIDECAR_VERSION,
    audio: { name: audioName, ...(await computeAudioKey(audio)) },
    savedAt: new Date().toISOString(),
    analysis,
  };
  await writeFile(dir, sidecarNameFor(audioName), JSON.stringify(sidecar));
}

async function sameAudio(a: Blob, b: Blob): Promise<boolean> {
  if (a.size !== b.size) {
    return false;
  }
  const [keyA, keyB] = await Promise.all([computeAudioKey(a), computeAudioKey(b)]);
  return keyA.headHash === keyB.headHash;
}

// Copies audio into dir under audioName, or "name (2).ext" and so on when a
// different song already has that name. Returns the name it ends up under.
async function copyAudioInto(dir: LibraryDirectory, audioName: string, audio: Blob) {
  const dot = audioName.lastIndexOf(".");
  const stem = dot > 0 ? audioName.slice(0, dot) : audioName;
  const ext = dot > 0 ? audioName.slice(dot) : "";
  for (let n = 1; n < 1000; n += 1) {
    const candidate = n === 1 ? audioName : `${stem} (${n})${ext}`;
    const existing = await tryGetFile(dir, candidate);
    if (!existing) {
      await writeFile(dir, candidate, audio);
      return candidate;
    }
    if (await sameAudio(existing, audio)) {
      return candidate;
    }
  }
  throw new Error(`No free file name for ${audioName}`);
}

export async function getFolderPermission(dir: LibraryDirectory): Promise<FolderPermission> {
  if (!dir.queryPermission) {
    return "granted";
  }
  return dir.queryPermission({ mode: "readwrite" });
}

// Needs a user gesture (click) when the browser has to ask.
export async function requestFolderPermission(dir: LibraryDirectory): Promise<FolderPermission> {
  if (!dir.requestPermission) {
    return getFolderPermission(dir);
  }
  return dir.requestPermission({ mode: "readwrite" });
}

// Layers the music folder over the app's own cache for one song: a sidecar
// answers when the app cache has nothing, and every analysis is written to both.
export class LibraryAnalysisCache implements AnalysisCachePort {
  private savedAs: string | null = null;

  constructor(
    private readonly base: AnalysisCachePort,
    private readonly target: LibraryTarget,
    private readonly audio: File,
  ) {}

  async get(fingerprint: string): Promise<AnalysisOutput | null> {
    const cached = await this.base.get(fingerprint);
    if (cached) {
      // Analyzed before it was in the library: save it there too.
      this.saveToFolder(cached, { onlyIfMissing: true }).catch((err: unknown) => {
        console.warn(`Library save failed: ${String(err)}`);
      });
      return cached;
    }
    // Also covers a dropped song whose copy is already in the folder.
    return readSidecar(this.target.dir, this.target.audioName, this.audio);
  }

  async set(fingerprint: string, analysis: AnalysisOutput): Promise<void> {
    const results = await Promise.allSettled([
      this.base.set(fingerprint, analysis),
      this.saveToFolder(analysis, { onlyIfMissing: false }),
    ]);
    const failed = results.find((result) => result.status === "rejected");
    if (failed) {
      throw (failed as PromiseRejectedResult).reason;
    }
  }

  // Files in the music folder belong to the user; only the app cache is cleared.
  clear(fingerprint: string): Promise<void> {
    return this.base.clear(fingerprint);
  }

  // Resolves to whether anything was written. Skips silently without write
  // access, which cannot be requested here (no user gesture).
  async saveToFolder(
    analysis: AnalysisOutput,
    options: { onlyIfMissing: boolean },
  ): Promise<boolean> {
    const { dir, audioName, copyAudio } = this.target;
    if ((await getFolderPermission(dir)) !== "granted") {
      return false;
    }
    if (this.savedAs) {
      return false;
    }
    const name = copyAudio ? await copyAudioInto(dir, audioName, this.audio) : audioName;
    if (options.onlyIfMissing && (await readSidecar(dir, name, this.audio))) {
      this.savedAs = name;
      return false;
    }
    await writeSidecar(dir, name, this.audio, analysis);
    this.savedAs = name;
    return true;
  }
}

function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(HANDLE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(HANDLE_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

async function withHandleStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openHandleDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = fn(db.transaction(HANDLE_STORE_NAME, mode).objectStore(HANDLE_STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
    });
  } finally {
    db.close();
  }
}

export async function loadMusicFolder(): Promise<LibraryDirectory | null> {
  try {
    const handle = await withHandleStore<unknown>("readonly", (store) => store.get(HANDLE_KEY));
    return (handle as LibraryDirectory | undefined) ?? null;
  } catch {
    return null;
  }
}

// Resolves to null when the user cancels the picker.
export async function pickMusicFolder(): Promise<LibraryDirectory | null> {
  const picker = (window as unknown as {
    showDirectoryPicker: (options: { id: string; mode: "readwrite" }) => Promise<LibraryDirectory>;
  }).showDirectoryPicker;
  let dir: LibraryDirectory;
  try {
    dir = await picker({ id: "forever-jukebox-library", mode: "readwrite" });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return null;
    }
    throw err;
  }
  await withHandleStore("readwrite", (store) => store.put(dir, HANDLE_KEY));
  return dir;
}
