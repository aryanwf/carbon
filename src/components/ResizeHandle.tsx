"use client";

import { useRef } from "react";

type Props = {
  onResize: (deltaPx: number) => void;
  orientation?: "vertical";
  ariaLabel?: string;
};

export function ResizeHandle({
  onResize,
  orientation = "vertical",
  ariaLabel = "Resize panel",
}: Props) {
  const startX = useRef(0);
  const dragging = useRef(false);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    startX.current = e.clientX;
    (e.target as HTMLDivElement).setPointerCapture(e.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const delta = e.clientX - startX.current;
    if (delta !== 0) {
      onResize(delta);
      startX.current = e.clientX;
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    (e.target as HTMLDivElement).releasePointerCapture(e.pointerId);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={ariaLabel}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className="group relative w-1 shrink-0 cursor-col-resize transition-colors"
    >
      <span className="absolute inset-y-0 -left-2 -right-2 z-10" />
      <div className="h-full w-full rounded-full bg-transparent transition-colors duration-300 ease-spring group-hover:bg-white/20 group-active:bg-muted" />
    </div>
  );
}
