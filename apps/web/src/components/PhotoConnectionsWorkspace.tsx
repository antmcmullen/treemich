/**
 * @file Connections workspace: pairs who appear together in Immich photos but are not linked in the tree.
 */

import { useEffect, useMemo, useState } from "react";
import {
  getCooccurrenceStatus,
  getPhotoCooccurrence,
  immichPhotosTogetherUrl,
  importImmichCooccurrence,
  personThumbnailUrl,
  type CooccurrenceJobResponse,
  type Person,
  type PhotoCooccurrenceResponse,
  type RelationshipRecord,
  type RelationshipType
} from "../lib/api";
import { RELATIONSHIP_TYPES } from "../lib/relationshipConstants";
import { buildUnlinkedPhotoPairs, immichPersonIdOf, type UnlinkedPhotoPair } from "./graph/photoConnections";

type Props = {
  people: Person[];
  relationships: RelationshipRecord[];
  dismissedKeys: string[];
  immichBaseUrl?: string | null;
  isSavingRelationship: boolean;
  onCreateRelationship: (
    sourcePersonId: string,
    targetPersonId: string,
    relationshipType: RelationshipType
  ) => Promise<void>;
  onDismiss: (key: string) => void;
  onOpenPerson: (personId: string) => void;
  loadConnections?: (
    minSharedPhotos: number,
    options: { signal?: AbortSignal }
  ) => Promise<PhotoCooccurrenceResponse>;
  loadStatus?: (options: { signal?: AbortSignal }) => Promise<CooccurrenceJobResponse>;
  startRefresh?: () => Promise<unknown>;
  /** How often to re-check a running refresh. */
  statusPollMs?: number;
};

const minSharedPhotoOptions = [2, 3, 5, 10, 20] as const;
const defaultMinSharedPhotos = 3;
const pageSize = 25;

const defaultLoadConnections: NonNullable<Props["loadConnections"]> = (minSharedPhotos, options) =>
  getPhotoCooccurrence(minSharedPhotos, options);
const defaultLoadStatus: NonNullable<Props["loadStatus"]> = (options) => getCooccurrenceStatus(options);

const isRunning = (status: CooccurrenceJobResponse | null) =>
  status?.job?.status === "PENDING" || status?.job?.status === "RUNNING";

const formatDate = (value?: string | null) =>
  value
    ? new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
    : null;

const plural = (count: number, word: string) => `${count.toLocaleString()} ${word}${count === 1 ? "" : "s"}`;

const describeStatus = (status: CooccurrenceJobResponse | null) => {
  if (!status) {
    return "Checking when photos were last counted…";
  }
  const { job, schedule } = status;
  const nextRun = formatDate(schedule.nextRunAt);
  const scheduleText = schedule.refreshEnabled
    ? `Counts refresh every ${plural(schedule.refreshIntervalDays, "day")}${nextRun ? `, next on ${nextRun}` : ""}.`
    : "Automatic refresh is off.";
  if (!job) {
    return `Photos have not been counted yet. ${scheduleText}`;
  }
  if (job.status === "PENDING" || job.status === "RUNNING") {
    return "Counting the faces in your Immich photos…";
  }
  if (job.status === "FAILED") {
    return `The last count failed${job.errorMessage ? `: ${job.errorMessage}` : ""}. ${scheduleText}`;
  }
  const photos = job.sourcePhotoCount != null ? ` from ${plural(job.sourcePhotoCount, "photo")}` : "";
  return `Last counted on ${formatDate(job.completedAt) ?? "an unknown date"}${photos}. ${scheduleText}`;
};

type ConnectionsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: PhotoCooccurrenceResponse };

export const PhotoConnectionsWorkspace = ({
  people,
  relationships,
  dismissedKeys,
  immichBaseUrl,
  isSavingRelationship,
  onCreateRelationship,
  onDismiss,
  onOpenPerson,
  loadConnections = defaultLoadConnections,
  loadStatus = defaultLoadStatus,
  startRefresh = importImmichCooccurrence,
  statusPollMs = 3000
}: Props) => {
  const [minSharedPhotos, setMinSharedPhotos] = useState<number>(defaultMinSharedPhotos);
  const [connections, setConnections] = useState<ConnectionsState>({ status: "loading" });
  const [dataVersion, setDataVersion] = useState(0);
  const [status, setStatus] = useState<CooccurrenceJobResponse | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [isStartingRefresh, setIsStartingRefresh] = useState(false);
  const [visibleCount, setVisibleCount] = useState(pageSize);

  useEffect(() => {
    const controller = new AbortController();
    setConnections({ status: "loading" });
    setVisibleCount(pageSize);
    loadConnections(minSharedPhotos, { signal: controller.signal }).then(
      (data) => {
        if (!controller.signal.aborted) {
          setConnections({ status: "ready", data });
        }
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setConnections({
            status: "error",
            message: error instanceof Error ? error.message : "Couldn’t load photo connections."
          });
        }
      }
    );
    return () => controller.abort();
  }, [dataVersion, loadConnections, minSharedPhotos]);

  useEffect(() => {
    const controller = new AbortController();
    loadStatus({ signal: controller.signal }).then(
      (next) => {
        if (!controller.signal.aborted) {
          setStatus(next);
        }
      },
      () => {
        if (!controller.signal.aborted) {
          setStatusError("Couldn’t check when photos were last counted.");
        }
      }
    );
    return () => controller.abort();
  }, [loadStatus]);

  const jobRunning = isRunning(status);
  useEffect(() => {
    if (!jobRunning) {
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      loadStatus({}).then(
        (next) => {
          if (cancelled) {
            return;
          }
          setStatus(next);
          if (!isRunning(next)) {
            setDataVersion((version) => version + 1);
          }
        },
        () => {
          if (!cancelled) {
            setStatusError("Couldn’t check on the refresh. Reload the page to see the latest counts.");
          }
        }
      );
    }, statusPollMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [jobRunning, loadStatus, status, statusPollMs]);

  const handleRefresh = async () => {
    setIsStartingRefresh(true);
    setStatusError(null);
    let startError: string | null = null;
    try {
      await startRefresh();
    } catch (error: unknown) {
      startError = error instanceof Error ? error.message : "Couldn’t start the refresh.";
    }
    // A failed start can still mean a count is under way (the API answers 409 to a second start),
    // so the job status decides whether to wait or to show the error.
    try {
      const next = await loadStatus({});
      setStatus(next);
      if (!isRunning(next)) {
        if (startError) {
          setStatusError(startError);
        } else {
          setDataVersion((version) => version + 1);
        }
      }
    } catch {
      setStatusError(startError ?? "The refresh started, but its progress couldn’t be checked.");
    } finally {
      setIsStartingRefresh(false);
    }
  };

  const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);
  const pairs = useMemo<UnlinkedPhotoPair[]>(
    () =>
      connections.status === "ready"
        ? buildUnlinkedPhotoPairs({ edges: connections.data.edges, people, relationships, dismissedKeys })
        : [],
    [connections, dismissedKeys, people, relationships]
  );
  const visiblePairs = pairs.slice(0, visibleCount);
  const hiddenCount = pairs.length - visiblePairs.length;
  const edgeCount = connections.status === "ready" ? connections.data.edges.length : 0;

  const photosTogetherUrl = (pair: UnlinkedPhotoPair) => {
    const first = immichPersonIdOf(peopleById.get(pair.personAId));
    const second = immichPersonIdOf(peopleById.get(pair.personBId));
    return first && second ? immichPhotosTogetherUrl([first, second], immichBaseUrl) : null;
  };

  const renderPerson = (personId: string, name: string) => (
    <>
      <img className="relative-avatar" src={personThumbnailUrl(personId)} alt={name} />
      <button
        type="button"
        className="text-link-button relative-name-button"
        onClick={() => onOpenPerson(personId)}
      >
        {name}
      </button>
    </>
  );

  return (
    <section className="workspace-main-stack workspace-main-stack--secondary">
      <section className="card stack workspace-intro-card">
        <div className="stack">
          <h2>Photo connections</h2>
          <p className="hint">
            People who appear together in your Immich photos but aren’t linked in the tree yet. Add them as
            friends, open either person to add a family link, or dismiss pairs that don’t matter.
          </p>
        </div>
        <p className="hint" role="status">
          {describeStatus(status)}
        </p>
        {statusError ? <p className="hint hint--danger">{statusError}</p> : null}
        <div className="workspace-action-row">
          <button
            type="button"
            className="secondary-button workspace-action-button"
            disabled={isStartingRefresh || jobRunning}
            onClick={() => void handleRefresh()}
          >
            {jobRunning ? "Counting…" : "Refresh from Immich"}
          </button>
          <label className="settings-toggle">
            <span>Shared photos</span>
            <select
              aria-label="Minimum shared photos"
              value={minSharedPhotos}
              onChange={(event) => setMinSharedPhotos(Number(event.target.value))}
            >
              {minSharedPhotoOptions.map((option) => (
                <option key={option} value={option}>
                  {option} or more
                </option>
              ))}
            </select>
          </label>
          {connections.status === "ready" ? (
            <span className="status-pill">{plural(pairs.length, "pair")} not linked</span>
          ) : null}
        </div>
      </section>

      <section className="card stack workspace-intro-card">
        <h3>Not linked in the tree</h3>
        {connections.status === "loading" ? <p className="hint">Loading photo connections…</p> : null}
        {connections.status === "error" ? <p className="hint hint--danger">{connections.message}</p> : null}
        {connections.status === "ready" && edgeCount === 0 ? (
          <p className="hint">
            {status?.job
              ? `No two linked people share ${minSharedPhotos} or more photos.`
              : "Nothing counted yet. Refresh from Immich to count who appears together."}
          </p>
        ) : null}
        {connections.status === "ready" && edgeCount > 0 && pairs.length === 0 ? (
          <p className="hint">
            Everyone who shares {minSharedPhotos} or more photos is already linked in the tree.
          </p>
        ) : null}
        {visiblePairs.length > 0 ? (
          <ul className="relatives-list" aria-label="Photo connections not linked in the tree">
            {visiblePairs.map((pair) => {
              const photosUrl = photosTogetherUrl(pair);
              const pairLabel = `${pair.personAName} and ${pair.personBName}`;
              return (
                <li key={pair.key} className="relative-card photo-pair-card">
                  <div className="relative-main">
                    <div className="relative-summary photo-pair-people">
                      {renderPerson(pair.personAId, pair.personAName)}
                      <span className="hint" aria-hidden="true">
                        &amp;
                      </span>
                      {renderPerson(pair.personBId, pair.personBName)}
                    </div>
                    <p className="hint photo-connection-count">
                      {photosUrl ? (
                        <a href={photosUrl} target="_blank" rel="noreferrer">
                          {plural(pair.sharedPhotos, "photo")} together
                        </a>
                      ) : (
                        `${plural(pair.sharedPhotos, "photo")} together`
                      )}
                    </p>
                  </div>
                  <div className="relative-actions">
                    <button
                      type="button"
                      className="secondary-button workspace-action-button"
                      disabled={isSavingRelationship}
                      aria-label={`Add ${pairLabel} as friends`}
                      onClick={() =>
                        void onCreateRelationship(pair.personAId, pair.personBId, RELATIONSHIP_TYPES.friendOf)
                      }
                    >
                      Add as friends
                    </button>
                    <button
                      type="button"
                      className="text-link-button"
                      aria-label={`Dismiss ${pairLabel}`}
                      onClick={() => onDismiss(pair.key)}
                    >
                      Dismiss
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
        {hiddenCount > 0 ? (
          <button
            type="button"
            className="secondary-button workspace-action-button"
            onClick={() => setVisibleCount((count) => count + pageSize)}
          >
            Show {Math.min(pageSize, hiddenCount)} more of {hiddenCount}
          </button>
        ) : null}
      </section>
    </section>
  );
};
