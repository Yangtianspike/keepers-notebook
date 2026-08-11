"use client";

import type { ReactNode } from "react";

export function SettingsModal({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="settings-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="模型连接设置"
      >
        <button
          className="settings-modal-close"
          aria-label="关闭设置"
          onClick={onClose}
        >
          ×
        </button>
        {children}
      </section>
    </div>
  );
}
