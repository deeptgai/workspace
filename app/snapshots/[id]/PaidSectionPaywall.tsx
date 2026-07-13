"use client";

import { PaidAccessPrompt } from "./PaidAccessPrompt";
import type { PaidTabAccess } from "./snapshotTypes";

type PaidSectionPaywallProps = {
  access: PaidTabAccess | null;
  pending: boolean;
  title: string;
  onOpen: () => void;
};

export function PaidSectionPaywall({ access, pending, title, onOpen }: PaidSectionPaywallProps) {
  return (
    <div className="flex justify-center">
      <PaidAccessPrompt
        access={access}
        actionLabel="Открыть раздел"
        browserActionLabel="Войти через Telegram"
        pending={pending}
        showIcon
        title={title}
        onOpen={onOpen}
      />
    </div>
  );
}
