import { describe, expect, it } from "vitest";
import { resolveFilterVisibilityWhenRelationshipsArrive } from "./noRelationshipsFilterDefaults";
import { defaultGraphFilterVisibility, type GraphFilterVisibility } from "./relationshipStyles";

const allOff: GraphFilterVisibility = {
  parentChild: false,
  spouse: false,
  sibling: false,
  friends: false,
  pets: false
};

describe("resolveFilterVisibilityWhenRelationshipsArrive", () => {
  it("turns layers back on when the first relationships arrive after an empty start", () => {
    expect(
      resolveFilterVisibilityWhenRelationshipsArrive({
        wasNoRelationshipsDefault: true,
        isNoRelationshipsDefault: false,
        currentVisibility: allOff,
        noRelationshipsVisibility: allOff,
        defaultVisibility: defaultGraphFilterVisibility
      })
    ).toEqual(defaultGraphFilterVisibility);
  });

  it("keeps a layer the user changed while the tree was empty", () => {
    expect(
      resolveFilterVisibilityWhenRelationshipsArrive({
        wasNoRelationshipsDefault: true,
        isNoRelationshipsDefault: false,
        currentVisibility: { ...allOff, spouse: true },
        noRelationshipsVisibility: allOff,
        defaultVisibility: defaultGraphFilterVisibility
      })
    ).toBeNull();
  });

  it("does nothing while the tree still has no relationships", () => {
    expect(
      resolveFilterVisibilityWhenRelationshipsArrive({
        wasNoRelationshipsDefault: true,
        isNoRelationshipsDefault: true,
        currentVisibility: allOff,
        noRelationshipsVisibility: allOff,
        defaultVisibility: defaultGraphFilterVisibility
      })
    ).toBeNull();
  });

  it("does nothing when the tree never started empty", () => {
    expect(
      resolveFilterVisibilityWhenRelationshipsArrive({
        wasNoRelationshipsDefault: false,
        isNoRelationshipsDefault: false,
        currentVisibility: allOff,
        noRelationshipsVisibility: allOff,
        defaultVisibility: defaultGraphFilterVisibility
      })
    ).toBeNull();
  });
});
