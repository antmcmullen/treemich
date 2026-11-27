import { describe, expect, it } from "vitest";
import type { PersonRecord, RelationshipRecord, RelationshipType } from "../../lib/api";
import {
  buildFamilyGroups,
  buildPersonPhotoConnections,
  buildUnlinkedPhotoPairs,
  distantRelativeLabel,
  immichPersonIdOf,
  photoConnectionDismissKey
} from "./photoConnections";

const person = (id: string, immichId?: string): PersonRecord => ({
  id,
  name: id.toUpperCase(),
  profile: { id, gender: "UNKNOWN", givenName: id, surname: null },
  externalIdentities: immichId
    ? [
        {
          id: `identity-${id}`,
          personId: id,
          provider: "IMMICH",
          providerPersonId: immichId,
          providerBaseUrl: null,
          displayName: null,
          thumbnailImportedAt: null,
          lastSeenAt: null,
          metadata: {},
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z"
        }
      ]
    : [],
  thumbnail: null,
  thumbnailPath: null
});

const link = (fromPersonId: string, type: RelationshipType, toPersonId: string): RelationshipRecord => ({
  fromPersonId,
  toPersonId,
  type
});

const edge = (personAId: string, personBId: string, sharedPhotos: number, score = 0.5) => ({
  personAId,
  personBId,
  sharedPhotos,
  score
});

describe("buildFamilyGroups", () => {
  it("joins children of one parent and their cousins without sibling records", () => {
    const groups = buildFamilyGroups([
      link("grandma", "PARENT_OF", "mum"),
      link("grandma", "PARENT_OF", "uncle"),
      link("mum", "PARENT_OF", "me"),
      link("uncle", "PARENT_OF", "cousin"),
      link("mum", "SPOUSE_OF", "dad")
    ]);

    expect(groups.get("me")).toBe(groups.get("cousin"));
    expect(groups.get("me")).toBe(groups.get("dad"));
  });

  it("does not join people through friend or pet links", () => {
    const groups = buildFamilyGroups([
      link("me", "FRIEND_OF", "pal"),
      link("me", "PET_OF", "dog"),
      link("me", "PARENT_OF", "kid")
    ]);

    expect(groups.get("pal")).toBeUndefined();
    expect(groups.get("dog")).toBeUndefined();
    expect(groups.get("me")).toBe(groups.get("kid"));
  });
});

describe("buildPersonPhotoConnections", () => {
  const people = ["me", "sister", "cousin", "pal", "stranger"].map((id) => person(id));
  const peopleById = new Map(people.map((entry) => [entry.id, entry]));
  const familyGroups = buildFamilyGroups([
    link("mum", "PARENT_OF", "me"),
    link("mum", "PARENT_OF", "sister"),
    link("grandma", "PARENT_OF", "mum"),
    link("grandma", "PARENT_OF", "aunt"),
    link("aunt", "PARENT_OF", "cousin")
  ]);

  it("orders by shared photos and labels each person by how the tree links them", () => {
    const rows = buildPersonPhotoConnections({
      personId: "me",
      edges: [
        edge("me", "pal", 4),
        edge("sister", "me", 30),
        edge("cousin", "me", 4, 0.9),
        edge("me", "stranger", 2),
        edge("sister", "pal", 50)
      ],
      peopleById,
      relationLabelByPersonId: new Map([
        ["sister", "Sister"],
        ["pal", "Friend"]
      ]),
      familyGroups
    });

    expect(rows.map((row) => [row.personId, row.sharedPhotos, row.relationLabel])).toEqual([
      ["sister", 30, "Sister"],
      ["cousin", 4, distantRelativeLabel],
      ["pal", 4, "Friend"],
      ["stranger", 2, null]
    ]);
  });

  it("skips people missing from the tree and repeated pairs", () => {
    const rows = buildPersonPhotoConnections({
      personId: "me",
      edges: [edge("me", "deleted", 9), edge("me", "pal", 3), edge("pal", "me", 1), edge("me", "me", 5)],
      peopleById,
      relationLabelByPersonId: new Map(),
      familyGroups
    });

    expect(rows.map((row) => [row.personId, row.sharedPhotos])).toEqual([["pal", 3]]);
  });
});

describe("buildUnlinkedPhotoPairs", () => {
  const people = ["me", "sister", "cousin", "pal", "neighbour", "colleague"].map((id) => person(id));
  const relationships = [
    link("mum", "PARENT_OF", "me"),
    link("mum", "PARENT_OF", "sister"),
    link("grandma", "PARENT_OF", "mum"),
    link("grandma", "PARENT_OF", "aunt"),
    link("aunt", "PARENT_OF", "cousin"),
    link("me", "FRIEND_OF", "pal")
  ];

  it("keeps only pairs with no relationship and no family chain, most shared first", () => {
    const pairs = buildUnlinkedPhotoPairs({
      edges: [
        edge("me", "sister", 80),
        edge("cousin", "me", 40),
        edge("me", "pal", 20),
        edge("pal", "sister", 6),
        edge("neighbour", "colleague", 9),
        edge("me", "missing", 50)
      ],
      people,
      relationships,
      dismissedKeys: []
    });

    expect(pairs.map((pair) => [pair.personAId, pair.personBId, pair.sharedPhotos])).toEqual([
      ["neighbour", "colleague", 9],
      ["pal", "sister", 6]
    ]);
    expect(pairs[0]?.key).toBe(photoConnectionDismissKey("colleague", "neighbour"));
  });

  it("leaves out dismissed pairs whichever way round they were stored", () => {
    const pairs = buildUnlinkedPhotoPairs({
      edges: [edge("neighbour", "colleague", 9), edge("pal", "sister", 6)],
      people,
      relationships,
      dismissedKeys: [photoConnectionDismissKey("colleague", "neighbour"), "graph-suggestion-key"]
    });

    expect(pairs.map((pair) => pair.key)).toEqual([photoConnectionDismissKey("pal", "sister")]);
  });
});

describe("immichPersonIdOf", () => {
  it("returns the linked Immich person ID or null", () => {
    expect(immichPersonIdOf(person("me", "immich-me"))).toBe("immich-me");
    expect(immichPersonIdOf(person("me"))).toBeNull();
    expect(immichPersonIdOf(undefined)).toBeNull();
  });
});
