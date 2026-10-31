import { useCallback, useEffect, useState } from "react";
import {
  FolderPermission,
  LibraryDirectory,
  LibrarySong,
  getFolderPermission,
  isMusicLibrarySupported,
  loadMusicFolder,
  pickMusicFolder,
  requestFolderPermission,
  scanLibrary,
} from "@/core/infrastructure/library/musicLibrary";

// The remembered music folder, its access state and its songs. Rescans
// whenever `active` turns on (Home is shown), so new analyses show up.
export function useMusicLibrary(active: boolean) {
  const supported = isMusicLibrarySupported();
  const [folder, setFolder] = useState<LibraryDirectory | null>(null);
  const [permission, setPermission] = useState<FolderPermission | null>(null);
  const [songs, setSongs] = useState<LibrarySong[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);

  const load = useCallback(
    async (dir: LibraryDirectory | null, nextPermission: FolderPermission | null) => {
      setFolder(dir);
      setPermission(nextPermission);
      setHasError(false);
      if (!dir || nextPermission !== "granted") {
        setSongs([]);
        return;
      }
      setIsLoading(true);
      try {
        setSongs(await scanLibrary(dir));
      } catch {
        setHasError(true);
        setSongs([]);
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const refresh = useCallback(async () => {
    const dir = await loadMusicFolder();
    await load(dir, dir ? await getFolderPermission(dir) : null);
  }, [load]);

  useEffect(() => {
    if (!supported || !active) {
      return;
    }
    refresh().catch((err) => {
      console.warn(`Failed to load music library: ${String(err)}`);
    });
  }, [supported, active, refresh]);

  const chooseFolder = useCallback(async () => {
    const dir = await pickMusicFolder();
    if (dir) {
      await load(dir, await getFolderPermission(dir));
    }
  }, [load]);

  const reconnect = useCallback(async () => {
    if (folder) {
      await load(folder, await requestFolderPermission(folder));
    }
  }, [folder, load]);

  return {
    supported,
    folder,
    isGranted: permission === "granted",
    songs,
    isLoading,
    hasError,
    chooseFolder,
    reconnect,
    refresh,
  };
}

export type MusicLibrary = ReturnType<typeof useMusicLibrary>;
