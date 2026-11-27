import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PersonRecord, RelationshipRecord } from "../../lib/api";
import { PhotoConnectionsSection, type LoadPersonPhotoEdges } from "./PhotoConnectionsSection";

const reactTestEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const person = (id: string, name: string, immichId?: string): PersonRecord => ({
  id,
  name,
  profile: { id, gender: "UNKNOWN", givenName: name, surname: null },
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

const me = person("me", "Alex", "immich-me");
const sister = person("sister", "Sam", "immich-sister");
const pal = person("pal", "Pat", "immich-pal");
const cousin = person("cousin", "Chris");
const people = [me, sister, pal, cousin];
const relationships: RelationshipRecord[] = [
  { fromPersonId: "mum", toPersonId: "me", type: "PARENT_OF" },
  { fromPersonId: "mum", toPersonId: "cousin-parent", type: "SIBLING_OF" },
  { fromPersonId: "cousin-parent", toPersonId: "cousin", type: "PARENT_OF" }
];

const edge = (otherId: string, sharedPhotos: number) => ({
  personAId: "me",
  personBId: otherId,
  sharedPhotos,
  score: 0.5
});

describe("PhotoConnectionsSection", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  const render = async (
    loadEdges: LoadPersonPhotoEdges,
    overrides: Partial<Parameters<typeof PhotoConnectionsSection>[0]> = {}
  ) => {
    await act(async () => {
      root.render(
        createElement(PhotoConnectionsSection, {
          person: me,
          peopleById: new Map(people.map((entry) => [entry.id, entry])),
          relationships,
          relationLabelByPersonId: new Map([["sister", "Sister"]]),
          immichBaseUrl: "https://photos.example/api",
          loadEdges,
          isCollapsed: false,
          onToggleCollapsed: vi.fn(),
          onFocusPerson: vi.fn(),
          onAddFriend: vi.fn().mockResolvedValue(undefined),
          isSavingRelationship: false,
          ...overrides
        })
      );
    });
  };

  const rowTexts = () => [...host.querySelectorAll("li")].map((item) => item.textContent ?? "");

  it("lists people by shared photos with how the tree links them", async () => {
    const loadEdges = vi
      .fn<LoadPersonPhotoEdges>()
      .mockResolvedValue([edge("pal", 3), edge("sister", 25), edge("cousin", 1)]);

    await render(loadEdges);

    expect(loadEdges).toHaveBeenCalledWith(
      "me",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(rowTexts()).toEqual([
      "SamSister25 photos together",
      "PatNot linked3 photos together+",
      "ChrisRelative1 photo together"
    ]);
    const photosLink = host.querySelector<HTMLAnchorElement>("li a");
    expect(photosLink?.href).toBe(
      `https://photos.example/search?query=${encodeURIComponent(
        JSON.stringify({ personIds: ["immich-me", "immich-sister"] })
      )}`
    );
    expect(host.querySelectorAll("li")[2]?.querySelector("a")).toBeNull();
  });

  it("offers to add only unlinked people as friends", async () => {
    const onAddFriend = vi.fn().mockResolvedValue(undefined);
    await render(vi.fn<LoadPersonPhotoEdges>().mockResolvedValue([edge("sister", 25), edge("pal", 3)]), {
      onAddFriend
    });

    const addButtons = [...host.querySelectorAll<HTMLButtonElement>('button[aria-label^="Add "]')];
    expect(addButtons.map((button) => button.getAttribute("aria-label"))).toEqual(["Add Pat as a friend"]);

    await act(async () => {
      addButtons[0]?.click();
    });
    expect(onAddFriend).toHaveBeenCalledWith("pal");
  });

  it("shows five people and reveals the rest on request", async () => {
    const others = Array.from({ length: 7 }, (_, index) => person(`p${index}`, `Person ${index}`));
    await render(
      vi
        .fn<LoadPersonPhotoEdges>()
        .mockResolvedValue(others.map((other, index) => edge(other.id, 20 - index))),
      { peopleById: new Map([me, ...others].map((entry) => [entry.id, entry])) }
    );

    expect(host.querySelectorAll("li")).toHaveLength(5);
    const showMore = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Show 2 more"
    );
    await act(async () => {
      showMore?.click();
    });
    expect(host.querySelectorAll("li")).toHaveLength(7);
  });

  it("explains an empty result and a failed load", async () => {
    await render(vi.fn<LoadPersonPhotoEdges>().mockResolvedValue([]));
    expect(host.textContent).toContain("No shared photos with other linked people yet.");

    await render(vi.fn<LoadPersonPhotoEdges>().mockRejectedValue(new Error("boom")));
    expect(host.textContent).toContain("Couldn’t load photo connections.");
  });
});
