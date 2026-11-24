import { describe, expect, it } from "vitest";
import { mergeUserPreferences, parseUserPreferences, withUserPreferenceDefaults } from "./preferences.js";

describe("user preferences: Tree view mode", () => {
  it("keeps the saved view mode and chart shape across partial updates", () => {
    const current = parseUserPreferences({ graphViewMode: "familyChart", familyChartShape: "descendants" });
    const merged = mergeUserPreferences(current, { graphRenderLimit: 200 });
    expect(merged.graphViewMode).toBe("familyChart");
    expect(merged.familyChartShape).toBe("descendants");

    const switched = mergeUserPreferences(merged, { graphViewMode: "graph3d" });
    expect(withUserPreferenceDefaults(parseUserPreferences(switched))).toMatchObject({
      graphViewMode: "graph3d",
      familyChartShape: "descendants"
    });
  });
});
