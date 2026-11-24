/**
 * @file Shared submit flow for the "add relative" popup (3D graph and 2D family chart).
 */

import type { CreatePersonBody } from "@treemich/shared";
import type { Person, RelationshipType } from "../../lib/api";
import { getPersonDisplayLabel } from "../../lib/personDisplay";
import { RELATIONSHIP_TYPES } from "../../lib/relationshipConstants";
import type { AddRelativeSubmitPayload } from "./AddRelativePopup";
import type { AddRelativeSlot } from "./NodeActionButtons";
import { findPersonBySearchTerm } from "./useGraphSearch";

/** Relationship stored from the anchor person to the new relative for a popup slot. */
export const resolveAddRelativeRelationshipType = (
  slot: AddRelativeSlot,
  selectedRelationshipType?: RelationshipType
): RelationshipType => {
  if (slot === "parent") {
    return RELATIONSHIP_TYPES.childOf;
  }
  if (slot === "child") {
    return RELATIONSHIP_TYPES.parentOf;
  }
  return selectedRelationshipType ?? RELATIONSHIP_TYPES.siblingOf;
};

type SubmitAddRelativeArgs = {
  payload: AddRelativeSubmitPayload;
  slot: AddRelativeSlot;
  anchorPersonId: string;
  people: Person[];
  onCreatePerson: (body: CreatePersonBody) => Promise<Person>;
  onCreateRelationship: (
    sourcePersonId: string,
    targetPersonId: string,
    type: RelationshipType
  ) => Promise<void>;
};

/**
 * Creates (or finds) the relative and links them to the anchor person.
 * Returns a short feedback message; throws a user-facing Error when the input is not usable.
 */
export const submitAddRelative = async ({
  payload,
  slot,
  anchorPersonId,
  people,
  onCreatePerson,
  onCreateRelationship
}: SubmitAddRelativeArgs): Promise<string> => {
  let targetId: string;
  let targetName: string;
  if (payload.type === "new") {
    const newPerson = await onCreatePerson({
      givenName: payload.givenName,
      surname: payload.surname,
      gender: payload.gender
    });
    targetId = newPerson.id;
    targetName = getPersonDisplayLabel(newPerson);
  } else {
    if (!payload.personName.trim()) {
      throw new Error("Type a person name.");
    }
    const match = findPersonBySearchTerm(people, payload.personName);
    if (!match) {
      throw new Error(`No person found for "${payload.personName}"`);
    }
    if (match.id === anchorPersonId) {
      throw new Error("Choose a different person.");
    }
    targetId = match.id;
    targetName = match.name;
  }
  await onCreateRelationship(
    anchorPersonId,
    targetId,
    resolveAddRelativeRelationshipType(slot, payload.relationshipType)
  );
  return payload.type === "new" ? `Created and added ${targetName}` : `Added ${targetName}`;
};
