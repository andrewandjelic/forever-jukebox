import React from "react";

// The volume popover, closed by outside clicks.
export function useVizPopovers() {
  const [isVolumeOpen, setIsVolumeOpen] = React.useState(false);
  const volumeButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const volumePanelRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!isVolumeOpen) {
      return;
    }
    const onDocumentClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (volumePanelRef.current?.contains(target)) {
        return;
      }
      if (volumeButtonRef.current?.contains(target)) {
        return;
      }
      setIsVolumeOpen(false);
    };
    document.addEventListener("click", onDocumentClick);
    return () => {
      document.removeEventListener("click", onDocumentClick);
    };
  }, [isVolumeOpen]);

  const toggleVolume = () => {
    setIsVolumeOpen((prev) => !prev);
  };

  return {
    isVolumeOpen,
    toggleVolume,
    volumeButtonRef,
    volumePanelRef,
  };
}
