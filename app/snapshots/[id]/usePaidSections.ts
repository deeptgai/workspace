"use client";

import { useCallback, useState } from "react";
import type { ChannelSnapshotDocument, SnapshotSignal, SnapshotSignalKind } from "../../../src/snapshots/sourceSnapshotSchema";
import { signalKinds } from "../../../src/snapshots/signalSections";
import type { TelegramAuthUser, TelegramWebApp } from "./TelegramAuthBadge";
import {
  paidTabSectionIds,
  type EvidenceMessage,
  type PaidTab,
  type PaidTabAccess,
} from "./snapshotTypes";

type UsePaidSectionsArgs = {
  getTelegramWebApp: () => Promise<TelegramWebApp | null>;
  initialTelegramUser?: TelegramAuthUser | null;
  paidSignalKinds: SnapshotSignalKind[];
  selectTabUnlocked: (tab: SnapshotSignalKind | "all") => void;
  snapshot: ChannelSnapshotDocument;
  snapshotPath: string;
};

function mergeEvidenceMessages(current: EvidenceMessage[], incoming: EvidenceMessage[]) {
  const messagesById = new Map(current.map((message) => [message.externalId, message]));

  for (const message of incoming) {
    messagesById.set(message.externalId, message);
  }

  return [...messagesById.values()];
}

function initialPaidTabAccess(paidSignalKinds: SnapshotSignalKind[], paidAccess: PaidTabAccess, freeAccess: PaidTabAccess) {
  const paidKinds = new Set(paidSignalKinds);

  return Object.fromEntries(signalKinds.map((kind) => [
    kind,
    paidKinds.has(kind) ? paidAccess : freeAccess,
  ])) as Record<PaidTab, PaidTabAccess>;
}

export function usePaidSections({
  getTelegramWebApp,
  initialTelegramUser,
  paidSignalKinds,
  selectTabUnlocked,
  snapshot,
  snapshotPath,
}: UsePaidSectionsArgs) {
  const [paidTabSignals, setPaidTabSignals] = useState<Partial<Record<PaidTab, SnapshotSignal[]>>>({});
  const [paidEvidenceMessages, setPaidEvidenceMessages] = useState<EvidenceMessage[]>([]);
  const [paidTabAccess, setPaidTabAccess] = useState<Record<PaidTab, PaidTabAccess>>(() => (
    initialPaidTabAccess(paidSignalKinds, initialTelegramUser ? "checking" : "browser", "unlocked")
  ));
  const [paymentMessage, setPaymentMessage] = useState("");
  const paidContentSlug = snapshotPath.startsWith("/s/") ? snapshotPath.slice(3).split("/")[0] : "";
  const setPaidAccess = useCallback((tab: PaidTab, access: PaidTabAccess) => {
    setPaidTabAccess((current) => current[tab] === access ? current : { ...current, [tab]: access });
  }, []);
  const loadPaidTabContent = useCallback(async (tab: PaidTab, initData?: string) => {
    if (paidTabSignals[tab]?.length) {
      return true;
    }

    if (!paidContentSlug) {
      return false;
    }

    const response = await fetch("/api/telegram/payments/section/content", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...(initData ? { initData } : {}),
        slug: paidContentSlug,
        sectionId: paidTabSectionIds[tab],
      }),
    });
    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Не удалось загрузить раздел.");
    }

    setPaidTabSignals((current) => ({ ...current, [tab]: payload.signals ?? [] }));
    setPaidEvidenceMessages((current) => mergeEvidenceMessages(current, payload.evidenceMessages ?? []));

    return true;
  }, [paidContentSlug, paidTabSignals]);
  const checkPaidTabAccess = useCallback(async (tab: PaidTab) => {
    const webApp = await getTelegramWebApp();
    const initData = webApp?.initData || window.Telegram?.WebApp?.initData || "";

    const response = await fetch("/api/telegram/payments/section/status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...(initData ? { initData } : {}),
        sourceId: snapshot.sourceId,
        sectionId: paidTabSectionIds[tab],
      }),
    });
    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Не удалось проверить доступ.");
    }

    if (!payload.access) {
      setPaidAccess(tab, "locked");
      return false;
    }

    await loadPaidTabContent(tab, initData);
    setPaidAccess(tab, "unlocked");
    return true;
  }, [getTelegramWebApp, loadPaidTabContent, setPaidAccess, snapshot.sourceId]);
  const openPaidTabPayment = useCallback(async (tab: PaidTab) => {
    if (paidTabAccess[tab] === "paying") {
      return;
    }

    setPaymentMessage("");

    const webApp = await getTelegramWebApp();
    const initData = webApp?.initData || window.Telegram?.WebApp?.initData || "";

    setPaidAccess(tab, "paying");

    try {
      const response = await fetch("/api/telegram/payments/section/invoice", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...(initData ? { initData } : {}),
          sourceId: snapshot.sourceId,
          sourceTitle: snapshot.chatTitle,
          sectionId: paidTabSectionIds[tab],
        }),
      });
      const payload = await response.json();

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Не удалось создать счет.");
      }

      if (payload.access) {
        await loadPaidTabContent(tab, initData);
        setPaidAccess(tab, "unlocked");
        selectTabUnlocked(tab);
        return;
      }

      if (!payload.invoiceLink) {
        throw new Error("Не удалось получить ссылку на счет.");
      }

      if (!initData || !webApp?.openInvoice) {
        setPaymentMessage("Открываем счет в Telegram...");
        window.location.href = payload.invoiceLink;
        setPaidAccess(tab, initData ? "locked" : "browser");
        return;
      }

      webApp.openInvoice(payload.webAppInvoiceLink || payload.invoiceLink, async (status) => {
        if (status !== "paid") {
          setPaidAccess(tab, "locked");
          setPaymentMessage("Оплата не завершена.");
          return;
        }

        setPaymentMessage("Оплата прошла, проверяем доступ...");

        for (let attempt = 0; attempt < 8; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 700));

          if (await checkPaidTabAccess(tab)) {
            setPaymentMessage("");
            selectTabUnlocked(tab);
            return;
          }
        }

        setPaidAccess(tab, "locked");
        setPaymentMessage("Платеж принят Telegram, ждем подтверждение webhook. Попробуй открыть раздел через пару секунд.");
      });
    } catch (error) {
      setPaidAccess(tab, initData ? "locked" : "browser");
      setPaymentMessage(error instanceof Error ? error.message : "Не удалось создать счет.");
    }
  }, [
    checkPaidTabAccess,
    getTelegramWebApp,
    loadPaidTabContent,
    paidTabAccess,
    selectTabUnlocked,
    setPaidAccess,
    snapshot.chatTitle,
    snapshot.sourceId,
  ]);

  return {
    checkPaidTabAccess,
    openPaidTabPayment,
    paidEvidenceMessages,
    paidTabAccess,
    paidTabSignals,
    paymentMessage,
    setPaidAccess,
    setPaymentMessage,
  };
}
