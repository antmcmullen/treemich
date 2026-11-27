/**
 * @file Rank people who appear together in Immich photos, and find pairs the tree does not link yet.
 */

import type { Person, PhotoCooccurrenceEdge, RelationshipRecord, RelationshipType } from "../../lib/api";
import { pairKey } from "./graphRelationshipLines";

type PhotoEdge = Pick<PhotoCooccurrenceEdge, "personAId" | "personBId" | "sharedPhotos" | "score">;

/** One person who shares photos with the selected person. */
export type PersonPhotoConnection = {
  personId: string;
  personName: string;
  sharedPhotos: number;
  score: number;
  /** How the tree links the two people, or null when nothing links them. */
  relationLabel: string | null;
};

/** Two people who share photos but are not linked in the tree. */
export type UnlinkedPhotoPair = {
  key: string;
  personAId: string;
  personAName: string;
  personBId: string;
  personBName: string;
  sharedPhotos: number;
  score: number;
};

/** Label for people joined only through a longer chain of family links. */
export const distantRelativeLabel = "Relative";

const familyRelationshipTypes = new Set<RelationshipType>([
  "PARENT_OF",
  "CHILD_OF",
  "SPOUSE_OF",
  "SIBLING_OF"
]);

/** Stored in `dismissedSuggestions` alongside graph suggestion keys; the prefix keeps them apart. */
export const photoConnectionDismissKey = (firstId: string, secondId: string) =>
  `photo:${pairKey(firstId, secondId)}`;

/**
 * Groups people joined by any chain of parent, child, spouse or sibling links.
 * Children of the same parent land together even without a sibling record, and so do their cousins.
 * Friend and pet links are left out: a friend of the family is not related to everyone in it.
 */
export const buildFamilyGroups = (relationships: RelationshipRecord[]): Map<string, string> => {
  const parent = new Map<string, string>();
  const find = (personId: string): string => {
    let root = personId;
    while (parent.has(root) && parent.get(root) !== root) {
      root = parent.get(root) as string;
    }
    let current = personId;
    while (current !== root) {
      const next = parent.get(current) as string;
      parent.set(current, root);
      current = next;
    }
    return root;
  };

  for (const relationship of relationships) {
    if (!familyRelationshipTypes.has(relationship.type)) {
      continue;
    }
    for (const personId of [relationship.fromPersonId, relationship.toPersonId]) {
      if (!parent.has(personId)) {
        parent.set(personId, personId);
      }
    }
    const fromRoot = find(relationship.fromPersonId);
    const toRoot = find(relationship.toPersonId);
    if (fromRoot !== toRoot) {
      parent.set(fromRoot, toRoot);
    }
  }

  const groups = new Map<string, string>();
  for (const personId of parent.keys()) {
    groups.set(personId, find(personId));
  }
  return groups;
};

const inSameFamily = (groups: Map<string, string>, firstId: string, secondId: string) => {
  const firstGroup = groups.get(firstId);
  return firstGroup !== undefined && firstGroup === groups.get(secondId);
};

/** Most shared photos first; the score breaks ties, then the name keeps the order stable. */
const compareShared = (
  left: { sharedPhotos: number; score: number },
  right: { sharedPhotos: number; score: number },
  leftName: string,
  rightName: string
) => right.sharedPhotos - left.sharedPhotos || right.score - left.score || leftName.localeCompare(rightName);

/**
 * Everyone in `edges` who shares a photo with `personId`, most shared photos first.
 * `relationLabelByPersonId` holds the labels the person panel already shows (Sister, 1st Cousin,
 * Friend); anyone else in the same family group is labelled {@link distantRelativeLabel}.
 */
export const buildPersonPhotoConnections = ({
  personId,
  edges,
  peopleById,
  relationLabelByPersonId,
  familyGroups
}: {
  personId: string;
  edges: PhotoEdge[];
  peopleById: Map<string, Person>;
  relationLabelByPersonId: Map<string, string>;
  familyGroups: Map<string, string>;
}): PersonPhotoConnection[] => {
  const rows = new Map<string, PersonPhotoConnection>();
  for (const edge of edges) {
    const otherId =
      edge.personAId === personId ? edge.personBId : edge.personBId === personId ? edge.personAId : null;
    const other = otherId && otherId !== personId ? peopleById.get(otherId) : undefined;
    if (!other || rows.has(other.id)) {
      continue;
    }
    rows.set(other.id, {
      personId: other.id,
      personName: other.name,
      sharedPhotos: edge.sharedPhotos,
      score: edge.score,
      relationLabel:
        relationLabelByPersonId.get(other.id) ??
        (inSameFamily(familyGroups, personId, other.id) ? distantRelativeLabel : null)
    });
  }

  return [...rows.values()].sort((left, right) =>
    compareShared(left, right, left.personName, right.personName)
  );
};

/**
 * Pairs from `edges` that the tree does not link: no relationship between the two of them and no
 * chain of family links either. Dismissed pairs are left out.
 */
export const buildUnlinkedPhotoPairs = ({
  edges,
  people,
  relationships,
  dismissedKeys
}: {
  edges: PhotoEdge[];
  people: Person[];
  relationships: RelationshipRecord[];
  dismissedKeys: Iterable<string>;
}): UnlinkedPhotoPair[] => {
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const dismissed = new Set(dismissedKeys);
  const directPairs = new Set(
    relationships.map((relationship) => pairKey(relationship.fromPersonId, relationship.toPersonId))
  );
  const familyGroups = buildFamilyGroups(relationships);

  const pairs: UnlinkedPhotoPair[] = [];
  for (const edge of edges) {
    const personA = peopleById.get(edge.personAId);
    const personB = peopleById.get(edge.personBId);
    if (!personA || !personB || personA.id === personB.id) {
      continue;
    }
    const key = photoConnectionDismissKey(personA.id, personB.id);
    if (
      dismissed.has(key) ||
      directPairs.has(pairKey(personA.id, personB.id)) ||
      inSameFamily(familyGroups, personA.id, personB.id)
    ) {
      continue;
    }
    pairs.push({
      key,
      personAId: personA.id,
      personAName: personA.name,
      personBId: personB.id,
      personBName: personB.name,
      sharedPhotos: edge.sharedPhotos,
      score: edge.score
    });
  }

  return pairs.sort((left, right) =>
    compareShared(
      left,
      right,
      `${left.personAName} ${left.personBName}`,
      `${right.personAName} ${right.personBName}`
    )
  );
};

/** Immich person ID for a Treemich person, when linked. */
export const immichPersonIdOf = (person: Person | undefined) =>
  person?.externalIdentities?.find((identity) => identity.provider === "IMMICH")?.providerPersonId ?? null;
