"use client";

import { Plus, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { addTrackedSourceAction } from "./actions";

type DiscoverableSource = {
  id: string;
  title: string;
  username: string | null;
  type: "channel" | "group" | "user" | "unknown";
};

export function AddSourceModal() {
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<DiscoverableSource[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

  useEffect(() => {
    if (!open || sources) {
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    fetch("/api/sources")
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error || "Could not load Telegram sources.");
        }

        return response.json() as Promise<{ sources: DiscoverableSource[] }>;
      })
      .then((payload) => {
        if (active) {
          setSources(payload.sources);
        }
      })
      .catch((fetchError: unknown) => {
        if (active) {
          setError(fetchError instanceof Error ? fetchError.message : "Could not load Telegram sources.");
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [open, sources]);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleSources = (sources ?? []).filter((source) => {
    if (!normalizedQuery) {
      return true;
    }

    return [
      source.title,
      source.username ? `@${source.username}` : "",
      source.type,
    ].some((value) => value.toLowerCase().includes(normalizedQuery));
  });

  return (
    <>
      <button className="sidebar-add-button" type="button" onClick={() => setOpen(true)}>
        <Plus size={15} />
        Add Source
      </button>

      {open ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <div
            className="modal-panel"
            role="dialog"
            aria-labelledby="add-source-title"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2 className="modal-title" id="add-source-title">Track Channel Or Group</h2>
                <p className="modal-subtitle">Choose a Telegram channel or group visible to your account.</p>
              </div>
              <button className="icon-button" type="button" aria-label="Close" onClick={() => setOpen(false)}>
                <X size={18} />
              </button>
            </div>

            <div className="modal-search">
              <Search size={16} />
              <input
                aria-label="Search Telegram sources"
                placeholder="Search by name or username"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>

            <div className="source-picker">
              {loading ? (
                <div className="source-picker-state">
                  <span className="spinner" />
                  Loading Telegram sources...
                </div>
              ) : null}

              {error ? (
                <div className="source-picker-state source-picker-error">{error}</div>
              ) : null}

              {!loading && !error && sources && visibleSources.length === 0 ? (
                <div className="source-picker-state">No channels or groups found.</div>
              ) : null}

              {!loading && !error ? visibleSources.map((source) => {
                const sourceRef = source.username ? `@${source.username}` : source.id;

                return (
                  <form action={addTrackedSourceAction} className="source-option" key={`${source.type}-${source.id}`}>
                    <input name="chat" type="hidden" value={sourceRef} />
                    <div className="source-option-main">
                      <strong>{source.title}</strong>
                      <span>{source.username ? `@${source.username}` : source.id}</span>
                    </div>
                    <span className="source-option-type">{source.type}</span>
                    <button className="button primary" type="submit">
                      <Plus size={15} />
                      Add
                    </button>
                  </form>
                );
              }) : null}
            </div>

          </div>
        </div>
      ) : null}
    </>
  );
}
