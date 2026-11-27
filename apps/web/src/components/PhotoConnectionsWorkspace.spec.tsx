import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiHttpError,
  type CooccurrenceJobResponse,
  type PersonRecord,
  type PhotoCooccurrenceResponse,
  type RelationshipRecord
} from "../lib/api";
import { PhotoConnectionsWorkspace } from "./PhotoConnectionsWorkspace";
import { photoConnectionDismissKey } from "./graph/photoConnections";

const reactTestEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const person = (id: string, name: string): PersonRecord => ({
  id,
  name,
  profile: { id, gender: "UNKNOWN", givenName: name, surname: null },
  externalIdentities: [],
  thumbnail: null,
  thumbnailPath: null
});

const people = [
  person("me", "Alex"),
  person("sister", "Sam"),
  person("pal", "Pat"),
  person("neighbour", "Nina")
];
const relationships: RelationshipRecord[] = [
  { fromPersonId: "mum", toPersonId: "me", type: "PARENT_OF" },
  { fromPersonId: "mum", toPersonId: "sister", type: "PARENT_OF" }
];

const response = (edges: PhotoCooccurrenceResponse["edges"]): PhotoCooccurrenceResponse => ({
  clusters: [],
  edges,
  computedAt: "2026-11-20T10:00:00.000Z",
  sourcePhotoCount: 1200
});

const completedStatus: CooccurrenceJobResponse = {
  job: {
    id: "job-1",
    status: "COMPLETED",
    sourcePhotoCount: 1200,
    edgeCount: 3,
    completedAt: "2026-11-20T10:00:00.000Z",
    createdAt: "2026-11-20T09:59:00.000Z",
    updatedAt: "2026-11-20T10:00:00.000Z"
  },
  schedule: { refreshEnabled: true, refreshIntervalDays: 7, nextRunAt: "2026-11-27T10:00:00.000Z" }
};

const runningStatus: CooccurrenceJobResponse = {
  ...completedStatus,
  job: { ...completedStatus.job!, id: "job-2", status: "RUNNING", completedAt: null }
};

const edges = response([
  { personAId: "me", personBId: "sister", sharedPhotos: 90, score: 0.9 },
  { personAId: "neighbour", personBId: "pal", sharedPhotos: 4, score: 0.4 },
  { personAId: "me", personBId: "pal", sharedPhotos: 12, score: 0.6 }
]);

describe("PhotoConnectionsWorkspace", () => {
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
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const render = async (overrides: Partial<Parameters<typeof PhotoConnectionsWorkspace>[0]> = {}) => {
    const props = {
      people,
      relationships,
      dismissedKeys: [],
      immichBaseUrl: null,
      isSavingRelationship: false,
      onCreateRelationship: vi.fn().mockResolvedValue(undefined),
      onDismiss: vi.fn(),
      onOpenPerson: vi.fn(),
      loadConnections: vi.fn().mockResolvedValue(edges),
      loadStatus: vi.fn().mockResolvedValue(completedStatus),
      startRefresh: vi.fn().mockResolvedValue({ jobId: "job-2", status: "PENDING" }),
      statusPollMs: 1000,
      ...overrides
    };
    await act(async () => {
      root.render(createElement(PhotoConnectionsWorkspace, props));
    });
    return props;
  };

  const rows = () => [...host.querySelectorAll("li")];
  const button = (label: string) =>
    [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (entry) => entry.textContent === label || entry.getAttribute("aria-label") === label
    );

  it("lists pairs the tree does not link, most shared photos first", async () => {
    const props = await render();

    expect(props.loadConnections).toHaveBeenCalledWith(3, expect.anything());
    expect(rows().map((row) => row.querySelector(".photo-pair-people")?.textContent)).toEqual([
      "Alex&Pat",
      "Nina&Pat"
    ]);
    expect(rows()[0]?.textContent).toContain("12 photos together");
    expect(host.textContent).toContain("2 pairs not linked");
    expect(host.textContent).toContain(`from ${(1200).toLocaleString()} photos`);
    expect(host.textContent).toContain("Counts refresh every 7 days");

    button("Pat")?.click();
    expect(props.onOpenPerson).toHaveBeenCalledWith("pal");
  });

  it("adds a pair as friends or dismisses it", async () => {
    const props = await render();

    await act(async () => {
      button("Add Alex and Pat as friends")?.click();
    });
    expect(props.onCreateRelationship).toHaveBeenCalledWith("me", "pal", "FRIEND_OF");

    button("Dismiss Nina and Pat")?.click();
    expect(props.onDismiss).toHaveBeenCalledWith(photoConnectionDismissKey("neighbour", "pal"));
  });

  it("hides dismissed pairs and reloads with a new threshold", async () => {
    const props = await render({ dismissedKeys: [photoConnectionDismissKey("me", "pal")] });
    expect(rows()).toHaveLength(1);

    const select = host.querySelector<HTMLSelectElement>('select[aria-label="Minimum shared photos"]');
    await act(async () => {
      if (select) {
        select.value = "10";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    expect(props.loadConnections).toHaveBeenLastCalledWith(10, expect.anything());
  });

  it("says when nothing has been counted yet", async () => {
    await render({
      loadConnections: vi.fn().mockResolvedValue(response([])),
      loadStatus: vi.fn().mockResolvedValue({ job: null, schedule: completedStatus.schedule })
    });

    expect(host.textContent).toContain("Photos have not been counted yet.");
    expect(host.textContent).toContain("Nothing counted yet. Refresh from Immich");
  });

  it("starts a refresh, waits for it to finish, then reloads the pairs", async () => {
    vi.useFakeTimers();
    const loadStatus = vi
      .fn()
      .mockResolvedValueOnce(completedStatus)
      .mockResolvedValueOnce(runningStatus)
      .mockResolvedValueOnce(completedStatus);
    const props = await render({ loadStatus });
    expect(props.loadConnections).toHaveBeenCalledTimes(1);

    await act(async () => {
      button("Refresh from Immich")?.click();
    });
    expect(props.startRefresh).toHaveBeenCalledTimes(1);
    expect(button("Counting…")?.disabled).toBe(true);
    expect(props.loadConnections).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(loadStatus).toHaveBeenCalledTimes(3);
    expect(props.loadConnections).toHaveBeenCalledTimes(2);
    expect(button("Refresh from Immich")?.disabled).toBe(false);
  });

  it("treats an already-running refresh as running", async () => {
    const loadStatus = vi.fn().mockResolvedValueOnce(completedStatus).mockResolvedValueOnce(runningStatus);
    await render({
      loadStatus,
      startRefresh: vi.fn().mockRejectedValue(new ApiHttpError(409, "already running"))
    });
    await act(async () => {
      button("Refresh from Immich")?.click();
    });
    expect(button("Counting…")).toBeDefined();
    expect(host.querySelector(".hint--danger")).toBeNull();
  });

  it("reports a refresh that could not start, including a 409 when nothing is running", async () => {
    const props = await render({
      loadStatus: vi.fn().mockResolvedValue(completedStatus),
      startRefresh: vi.fn().mockRejectedValue(new ApiHttpError(409, "Immich account is not linked"))
    });
    await act(async () => {
      button("Refresh from Immich")?.click();
    });
    expect(host.querySelector(".hint--danger")?.textContent).toBe("Immich account is not linked");
    expect(button("Refresh from Immich")?.disabled).toBe(false);
    expect(props.loadConnections).toHaveBeenCalledTimes(1);
  });
});
