import React from "react";
import type { LibraryTarget } from "@/core/infrastructure/library/musicLibrary";

type AppState = {
  file: File | null;
  // Where the current file's analysis is saved in the music folder, if any.
  libraryTarget: LibraryTarget | null;
  setFile: (file: File | null, libraryTarget?: LibraryTarget | null) => void;
  isListenLoading: boolean;
  setIsListenLoading: (isLoading: boolean) => void;
  isSettingsOpen: boolean;
  setIsSettingsOpen: (isOpen: boolean) => void;
};

const AppStateContext = React.createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = React.useState<{
    file: File | null;
    libraryTarget: LibraryTarget | null;
  }>({ file: null, libraryTarget: null });
  const [isListenLoading, setIsListenLoading] = React.useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
  const setFile = React.useCallback(
    (file: File | null, libraryTarget: LibraryTarget | null = null) => {
      setCurrent({ file, libraryTarget });
    },
    [],
  );
  const value = React.useMemo(
    () => ({
      file: current.file,
      libraryTarget: current.libraryTarget,
      setFile,
      isListenLoading,
      setIsListenLoading,
      isSettingsOpen,
      setIsSettingsOpen,
    }),
    [current, setFile, isListenLoading, isSettingsOpen]
  );
  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const ctx = React.useContext(AppStateContext);
  if (!ctx) {
    throw new Error("AppStateProvider missing");
  }
  return ctx;
}
