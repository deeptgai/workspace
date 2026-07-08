import type {
  ChannelSnapshotDocument,
  SnapshotEvidenceRef,
  SnapshotSignal,
  SnapshotSignalKind,
} from "../../src/snapshots/sourceSnapshotSchema";

type SeoEvidenceMessage = {
  externalId: string;
  publishedAt: string;
  text: string | null;
  user: {
    username: string | null;
    firstName: string | null;
    lastName: string | null;
  } | null;
};

type SnapshotSeoContentProps = {
  snapshot: ChannelSnapshotDocument;
  evidenceMessages: SeoEvidenceMessage[];
};

const kindLabels: Record<SnapshotSignalKind, string> = {
  idea: "Идея",
  pain: "Боль",
  hypothesis: "Гипотеза",
  insight: "Инсайт",
  material: "Материал",
  tool: "Инструмент",
  place: "Место",
  person: "Человек",
};

function cleanText(value: string | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function evidenceAuthor(message: SeoEvidenceMessage) {
  if (!message.user) {
    return null;
  }

  return [message.user.firstName, message.user.lastName].filter(Boolean).join(" ") ||
    (message.user.username ? `@${message.user.username}` : null);
}

function uniqueEvidence(evidence: SnapshotEvidenceRef[] | undefined) {
  const seen = new Set<string>();

  return (evidence ?? []).filter((item) => {
    if (seen.has(item.itemId)) {
      return false;
    }

    seen.add(item.itemId);
    return true;
  });
}

function signalDate(signal: SnapshotSignal) {
  return signal.timeline?.firstEvidenceAt ?? signal.timeline?.firstPostAt ?? signal.timeline?.firstCommentAt ?? null;
}

function sectionSignals(snapshot: ChannelSnapshotDocument, kind: SnapshotSignalKind) {
  return snapshot.signals.filter((signal) => signal.kind === kind);
}

export function SnapshotSeoContent({ snapshot, evidenceMessages }: SnapshotSeoContentProps) {
  const evidenceById = new Map(evidenceMessages.map((message) => [message.externalId, message]));
  const kinds = Array.from(new Set(snapshot.signals.map((signal) => signal.kind)));

  return (
    <article className="sr-only" aria-label="Текстовая версия снимка">
      <header>
        <h1>{snapshot.chatTitle}</h1>
        <p>{snapshot.title}</p>
        {snapshot.period.from || snapshot.period.to ? (
          <p>
            Период: {snapshot.period.from ? new Date(snapshot.period.from).toISOString() : "не указан"} - {snapshot.period.to ? new Date(snapshot.period.to).toISOString() : "не указан"}
          </p>
        ) : null}
      </header>

      {kinds.map((kind) => (
        <section key={kind}>
          <h2>{kindLabels[kind]}</h2>
          {sectionSignals(snapshot, kind).map((signal) => {
            const date = signalDate(signal);
            const evidence = uniqueEvidence(signal.evidence);

            return (
              <article key={signal.id}>
                <h3>{cleanText(signal.title)}</h3>
                {date ? <time dateTime={date}>{date}</time> : null}
                <p>{cleanText(signal.summary)}</p>
                {signal.tags.length ? (
                  <p>Теги: {signal.tags.join(", ")}</p>
                ) : null}
                {signal.timeline ? (
                  <p>
                    Временная привязка:
                    {signal.timeline.firstPostAt ? ` первый материал ${signal.timeline.firstPostAt};` : ""}
                    {signal.timeline.firstCommentAt ? ` первый комментарий ${signal.timeline.firstCommentAt};` : ""}
                    {signal.timeline.firstEvidenceAt ? ` первое подтверждение ${signal.timeline.firstEvidenceAt};` : ""}
                    {signal.timeline.lastEvidenceAt ? ` последнее подтверждение ${signal.timeline.lastEvidenceAt};` : ""}
                  </p>
                ) : null}
                {evidence.length ? (
                  <section>
                    <h4>Подтверждения</h4>
                    <ul>
                      {evidence.slice(0, 3).map((item) => {
                        const message = evidenceById.get(item.itemId);
                        const author = message ? evidenceAuthor(message) : null;

                        return (
                          <li key={item.itemId}>
                            {message ? <time dateTime={message.publishedAt}>{message.publishedAt}</time> : null}
                            {author ? ` ${author}.` : null}
                            {item.quote ? ` Цитата: ${cleanText(item.quote)}.` : null}
                            {item.reason ? ` Причина: ${cleanText(item.reason)}.` : null}
                            {message?.text ? ` Материал: ${cleanText(message.text).slice(0, 700)}` : null}
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ) : null}
              </article>
            );
          })}
        </section>
      ))}
    </article>
  );
}
