import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cacheGraphViewMode,
  GraphViewToggle,
  readCachedGraphViewMode,
  resolveGraphViewMode
} from "./GraphViewToggle";

const reactTestEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

describe("resolveGraphViewMode", () => {
  it("defaults to the 3D graph and honours the saved preference", () => {
    expect(resolveGraphViewMode(null)).toBe("graph3d");
    expect(resolveGraphViewMode({})).toBe("graph3d");
    expect(resolveGraphViewMode({ graphViewMode: "familyChart" })).toBe("familyChart");
  });

  it("falls back to this device's cached choice until preferences say otherwise", () => {
    window.localStorage.clear();
    expect(readCachedGraphViewMode()).toBeNull();
    cacheGraphViewMode("familyChart");
    expect(readCachedGraphViewMode()).toBe("familyChart");
    expect(resolveGraphViewMode(null, readCachedGraphViewMode())).toBe("familyChart");
    expect(resolveGraphViewMode({ graphViewMode: "graph3d" }, "familyChart")).toBe("graph3d");
    window.localStorage.setItem("treemich.graphViewMode", "nonsense");
    expect(readCachedGraphViewMode()).toBeNull();
  });
});

describe("GraphViewToggle", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const buttons = () => [...container.querySelectorAll("button")];

  it("marks the active view and reports a switch", () => {
    const onChange = vi.fn();
    act(() => {
      root.render(<GraphViewToggle value="graph3d" onChange={onChange} />);
    });
    const [tree, graph] = buttons();
    expect(tree?.textContent).toBe("Family tree");
    expect(graph?.getAttribute("aria-pressed")).toBe("true");
    expect(tree?.getAttribute("aria-pressed")).toBe("false");

    act(() => {
      tree!.click();
    });
    expect(onChange).toHaveBeenCalledWith("familyChart");

    act(() => {
      graph!.click();
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
