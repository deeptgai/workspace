"use client";

import { LockKeyhole, Save, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { SnapshotSignalKind } from "../../../src/snapshots/sourceSnapshotSchema";
import { signalSectionDefinitions } from "../../../src/snapshots/signalSections";
import { sourceAccessPriceUsd } from "../../../src/telegram/starsPayments";
import { updateSourcePaidSectionsAction } from "../../actions";

type PaidSectionsModalProps = {
  sourceId: string;
  paidSignalKinds: SnapshotSignalKind[];
  accessPriceUsdCents: number;
};

export function PaidSectionsModal({ sourceId, paidSignalKinds, accessPriceUsdCents }: PaidSectionsModalProps) {
  const [open, setOpen] = useState(false);
  const [selectedKinds, setSelectedKinds] = useState(() => new Set<SnapshotSignalKind>(paidSignalKinds));
  const [priceUsd, setPriceUsd] = useState(() => sourceAccessPriceUsd(accessPriceUsdCents));
  const selectedCount = selectedKinds.size;
  const selectedSummary = useMemo(() => {
    if (selectedCount === 0) {
      return "Все разделы бесплатные";
    }

    return `${selectedCount} платных разделов`;
  }, [selectedCount]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  const toggleKind = (kind: SnapshotSignalKind) => {
    setSelectedKinds((current) => {
      const next = new Set(current);

      if (next.has(kind)) {
        next.delete(kind);
      } else {
        next.add(kind);
      }

      return next;
    });
  };
  const openModal = () => {
    setSelectedKinds(new Set(paidSignalKinds));
    setPriceUsd(sourceAccessPriceUsd(accessPriceUsdCents));
    setOpen(true);
  };

  return (
    <>
      <button className="button" type="button" onClick={openModal}>
        <LockKeyhole size={15} />
        Платные разделы
      </button>

      {open ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <div
            className="modal-panel paid-sections-modal"
            role="dialog"
            aria-labelledby="paid-sections-title"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <form action={updateSourcePaidSectionsAction}>
              <div className="modal-header">
                <div>
                  <h2 className="modal-title" id="paid-sections-title">Платные разделы</h2>
                  <p className="modal-subtitle">Если ничего не выбрано, все разделы источника бесплатные.</p>
                </div>
                <button className="icon-button" type="button" aria-label="Close" onClick={() => setOpen(false)}>
                  <X size={18} />
                </button>
              </div>

              <input type="hidden" name="sourceId" value={sourceId} />

              <div className="paid-sections-summary">
                <span>{selectedSummary}</span>
              </div>

              <label className="paid-price-field">
                <span>Цена доступа, $</span>
                <input
                  className="input"
                  inputMode="decimal"
                  min="0.01"
                  name="accessPriceUsd"
                  step="0.01"
                  type="number"
                  value={priceUsd}
                  onChange={(event) => setPriceUsd(event.target.value)}
                />
              </label>

              <div className="paid-sections-grid">
                {signalSectionDefinitions.map((section) => {
                  const selected = selectedKinds.has(section.kind);

                  return (
                    <label className="paid-section-option" key={section.kind}>
                      <input
                        checked={selected}
                        name="paidSignalKind"
                        type="checkbox"
                        value={section.kind}
                        onChange={() => toggleKind(section.kind)}
                      />
                      <span>
                        <strong>{section.label}</strong>
                      </span>
                    </label>
                  );
                })}
              </div>

              <div className="modal-actions">
                <button className="button" type="button" onClick={() => setOpen(false)}>
                  Отмена
                </button>
                <button className="button primary" type="submit">
                  <Save size={15} />
                  Сохранить
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
