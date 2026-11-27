/**
 * @file Person sidebar section: people who appear in Immich photos with the selected person.
 */

import { useEffect, useMemo, useState } from "react";
import type { Person, PhotoCooccurrenceEdge, RelationshipRecord } from "../../lib/api";
import { immichPhotosTogetherUrl, personThumbnailUrl } from "../../lib/api";
import { buildFamilyGroups, buildPersonPhotoConnections, immichPersonIdOf } from "../graph/photoConnections";
import { CollapsibleSection } from "./CollapsibleSection";

type PhotoEdge = Pick<PhotoCooccurrenceEdge, "personAId" | "personBId" | "sharedPhotos" | "score">;

/** Loads every co-occurrence edge that involves one person. */
export type LoadPersonPhotoEdges = (
  personId: string,
  options: { signal: AbortSignal }
) => Promise<PhotoEdge[]>;

type Props = {
  person: Person;
  peopleById: Map<string, Person>;
  relationships: RelationshipRecord[];
  /** Labels such as "Sister", "1st Cousin" or "Friend" for people the tree already links. */
  relationLabelByPersonId: Map<string, string>;
  immichBaseUrl?: string | null;
  loadEdges: LoadPersonPhotoEdges;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  onFocusPerson: (personId: string) => void;
  onAddFriend: (personId: string) => Promise<void>;
  isSavingRelationship: boolean;
};

const initialVisibleCount = 5;

type LoadState = { status: "loading" } | { status: "error" } | { status: "ready"; edges: PhotoEdge[] };

const photoCountLabel = (count: number) =>
  `${count.toLocaleString()} photo${count === 1 ? "" : "s"} together`;

export const PhotoConnectionsSection = ({
  person,
  peopleById,
  relationships,
  relationLabelByPersonId,
  immichBaseUrl,
  loadEdges,
  isCollapsed,
  onToggleCollapsed,
  onFocusPerson,
  onAddFriend,
  isSavingRelationship
}: Props) => {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [visibleCount, setVisibleCount] = useState(initialVisibleCount);

  useEffect(() => {
    const controller = new AbortController();
    setLoadState({ status: "loading" });
    setVisibleCount(initialVisibleCount);
    loadEdges(person.id, { signal: controller.signal }).then(
      (edges) => {
        if (!controller.signal.aborted) {
          setLoadState({ status: "ready", edges });
        }
      },
      () => {
        if (!controller.signal.aborted) {
          setLoadState({ status: "error" });
        }
      }
    );
    return () => controller.abort();
  }, [loadEdges, person.id]);

  const familyGroups = useMemo(() => buildFamilyGroups(relationships), [relationships]);
  const connections = useMemo(
    () =>
      loadState.status === "ready"
        ? buildPersonPhotoConnections({
            personId: person.id,
            edges: loadState.edges,
            peopleById,
            relationLabelByPersonId,
            familyGroups
          })
        : [],
    [familyGroups, loadState, peopleById, person.id, relationLabelByPersonId]
  );
  const visibleConnections = connections.slice(0, visibleCount);
  const hiddenCount = connections.length - visibleConnections.length;
  const personImmichId = immichPersonIdOf(person);

  return (
    <CollapsibleSection
      sectionKey="photo-connections"
      title="Photos together"
      subtitle={`People who appear in your Immich photos with ${person.name}, most shared photos first.`}
      infoTooltip="Counted from the faces in your Immich library. Counts refresh on a schedule; refresh them now from the Connections workspace."
      count={connections.length > 0 ? connections.length : undefined}
      isCollapsed={isCollapsed}
      onToggleCollapsed={onToggleCollapsed}
    >
      {loadState.status === "loading" ? <p className="hint">Loading photo connections…</p> : null}
      {loadState.status === "error" ? (
        <p className="hint hint--danger">Couldn’t load photo connections.</p>
      ) : null}
      {loadState.status === "ready" && connections.length === 0 ? (
        <p className="hint">
          No shared photos with other linked people yet. Refresh the counts from the Connections workspace.
        </p>
      ) : null}
      {visibleConnections.length > 0 ? (
        <ul className="relatives-list" aria-label={`People in photos with ${person.name}`}>
          {visibleConnections.map((connection) => {
            const otherImmichId = immichPersonIdOf(peopleById.get(connection.personId));
            const photosUrl =
              personImmichId && otherImmichId
                ? immichPhotosTogetherUrl([personImmichId, otherImmichId], immichBaseUrl)
                : null;
            const addLabel = isSavingRelationship ? "Saving..." : `Add ${connection.personName} as a friend`;
            return (
              <li key={connection.personId} className="relative-card">
                <div className="relative-main">
                  <div className="relative-summary">
                    <img
                      className="relative-avatar"
                      src={personThumbnailUrl(connection.personId)}
                      alt={connection.personName}
                    />
                    <button
                      type="button"
                      className="text-link-button relative-name-button"
                      onClick={() => onFocusPerson(connection.personId)}
                    >
                      {connection.personName}
                    </button>
                    <span className="relative-pill">{connection.relationLabel ?? "Not linked"}</span>
                  </div>
                  <p className="hint photo-connection-count">
                    {photosUrl ? (
                      <a href={photosUrl} target="_blank" rel="noreferrer">
                        {photoCountLabel(connection.sharedPhotos)}
                      </a>
                    ) : (
                      photoCountLabel(connection.sharedPhotos)
                    )}
                  </p>
                </div>
                {connection.relationLabel === null ? (
                  <div className="relative-actions">
                    <button
                      type="button"
                      className="icon-action-button suggestion-accept-button"
                      disabled={isSavingRelationship}
                      onClick={() => void onAddFriend(connection.personId)}
                      aria-label={addLabel}
                      title={addLabel}
                    >
                      <span aria-hidden="true">+</span>
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {hiddenCount > 0 ? (
        <button
          type="button"
          className="secondary-button suggestion-show-more-button"
          onClick={() => setVisibleCount(connections.length)}
        >
          Show {hiddenCount} more
        </button>
      ) : null}
    </CollapsibleSection>
  );
};
