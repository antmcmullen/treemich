import { describe, expect, it } from "vitest";
import {
  emptyFamilyChartBranchState,
  layoutFamilyChart,
  toggleFamilyChartBranch,
  type FamilyChartLayout,
  type FamilyChartPerson,
  type FamilyChartRelationship,
  type RelationshipType
} from "../src/index.js";

// Made-up family:
//   Gp1 + Gm1        Gp2 + Gm2
//       |                |
//     Dad  +  Mum  ------+
//          |
//   Older, Focus (+ Partner), Younger      Half (Dad + Other)
//              |
//          Kid1, Kid2
//              |
//           Grandkid (child of Kid1) -> GreatGrandkid -> GGG
const person = (
  id: string,
  birthDate: string | null = null,
  gender: string | null = null
): FamilyChartPerson => ({
  id,
  name: id,
  birthDate,
  profile: gender ? { gender } : null
});

const people: FamilyChartPerson[] = [
  person("gp1", "1900", "MALE"),
  person("gm1", "1902", "FEMALE"),
  person("gp2", "1901", "MALE"),
  person("gm2", "1903", "FEMALE"),
  person("dad", "1930", "MALE"),
  person("mum", "1932", "FEMALE"),
  person("other", "1935", "FEMALE"),
  person("older", "1955"),
  person("focus", "1960"),
  person("younger", "1965"),
  person("half", "1970"),
  person("partner", "1961"),
  person("kid1", "1985"),
  person("kid2", "1988"),
  person("grandkid", "2010"),
  person("ggk", "2030"),
  person("gggk", "2050"),
  person("olderKid", "1980"),
  person("friend", "1960")
];

const rel = (fromPersonId: string, type: RelationshipType, toPersonId: string): FamilyChartRelationship => ({
  fromPersonId,
  toPersonId,
  type
});

const parentOf = (parent: string, ...children: string[]) =>
  children.map((child) => rel(parent, "PARENT_OF", child));

const relationships: FamilyChartRelationship[] = [
  ...parentOf("gp1", "dad"),
  rel("dad", "CHILD_OF", "gm1"),
  ...parentOf("gp2", "mum"),
  ...parentOf("gm2", "mum"),
  rel("gp1", "SPOUSE_OF", "gm1"),
  rel("dad", "SPOUSE_OF", "mum"),
  ...parentOf("dad", "older", "focus", "younger", "half"),
  ...parentOf("mum", "older", "focus", "younger"),
  ...parentOf("other", "half"),
  rel("focus", "SPOUSE_OF", "partner"),
  ...parentOf("focus", "kid1", "kid2"),
  ...parentOf("partner", "kid1", "kid2"),
  ...parentOf("kid1", "grandkid"),
  ...parentOf("grandkid", "ggk"),
  ...parentOf("ggk", "gggk"),
  ...parentOf("older", "olderKid"),
  rel("focus", "FRIEND_OF", "friend")
];

const nodeFor = (layout: FamilyChartLayout, personId: string) =>
  layout.nodes.find((node) => node.personId === personId);
const ids = (layout: FamilyChartLayout) => layout.nodes.map((node) => node.personId).sort();

const expectNoOverlaps = (layout: FamilyChartLayout) => {
  const byGeneration = new Map<number, number[]>();
  for (const node of layout.nodes) {
    byGeneration.set(node.generation, [...(byGeneration.get(node.generation) ?? []), node.x]);
  }
  for (const xs of byGeneration.values()) {
    const sorted = [...xs].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i]! - sorted[i - 1]!).toBeGreaterThanOrEqual(1 - 1e-9);
    }
  }
};

describe("layoutFamilyChart", () => {
  it("returns null when the focus person is unknown", () => {
    expect(layoutFamilyChart(people, relationships, "nobody")).toBeNull();
  });

  it("builds an hourglass with ancestors above, descendants below and siblings beside", () => {
    const layout = layoutFamilyChart(people, relationships, "focus")!;

    expect(nodeFor(layout, "focus")).toMatchObject({ role: "focus", generation: 0, branch: null });
    expect(nodeFor(layout, "partner")).toMatchObject({ role: "partner", generation: 0 });
    for (const id of ["dad", "mum"]) {
      expect(nodeFor(layout, id)).toMatchObject({ role: "ancestor", generation: -1 });
    }
    for (const id of ["gp1", "gm1", "gp2", "gm2"]) {
      expect(nodeFor(layout, id)).toMatchObject({ role: "ancestor", generation: -2 });
    }
    for (const id of ["older", "younger", "half"]) {
      expect(nodeFor(layout, id)).toMatchObject({ role: "sibling", generation: 0 });
    }
    expect(nodeFor(layout, "kid1")).toMatchObject({ role: "descendant", generation: 1 });
    expect(nodeFor(layout, "grandkid")).toMatchObject({ generation: 2 });
    expect(nodeFor(layout, "ggk")).toMatchObject({ generation: 3, branch: "down", branchHidden: true });
    expect(nodeFor(layout, "gggk")).toBeUndefined();
    expect(layout.minGeneration).toBe(-2);
    expect(layout.maxGeneration).toBe(3);
    expectNoOverlaps(layout);
  });

  it("ignores non-family relationships such as friends", () => {
    const layout = layoutFamilyChart(people, relationships, "focus")!;
    expect(nodeFor(layout, "friend")).toBeUndefined();
  });

  it("orders siblings by birth and keeps the focus's partner beside them", () => {
    const layout = layoutFamilyChart(people, relationships, "focus")!;
    const x = (id: string) => nodeFor(layout, id)!.x;
    expect(x("older")).toBeLessThan(x("focus"));
    expect(x("focus")).toBeLessThan(x("younger"));
    expect(x("younger")).toBeLessThan(x("half"));
    expect(x("partner") - x("focus")).toBeCloseTo(1);
  });

  it("puts children below their parents and parents over the full siblings", () => {
    const layout = layoutFamilyChart(people, relationships, "focus")!;
    const x = (id: string) => nodeFor(layout, id)!.x;
    expect((x("kid1") + x("kid2")) / 2).toBeCloseTo((x("focus") + x("partner")) / 2);
    expect((x("dad") + x("mum")) / 2).toBeCloseTo((x("older") + x("younger")) / 2);
    expect(x("gp1")).toBeLessThan(x("gp2"));
  });

  it("draws couples and one connector per parent set, separating half siblings", () => {
    const layout = layoutFamilyChart(people, relationships, "focus")!;
    const parents = layout.edges.filter((edge) => edge.kind === "parents");
    const focusRow = parents.filter((edge) => edge.key.endsWith(":focus-row"));
    expect(focusRow).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ parentKeys: ["dad", "mum"], childKeys: ["older", "focus", "younger"] }),
        expect.objectContaining({ parentKeys: ["dad"], childKeys: ["half"] })
      ])
    );
    expect(parents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ parentKeys: ["focus", "partner"], childKeys: ["kid1", "kid2"] })
      ])
    );
    expect(layout.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "couple", fromKey: "focus", toKey: "partner" }),
        expect.objectContaining({ kind: "couple", fromKey: "dad", toKey: "mum" })
      ])
    );
  });

  it("shows an unmarried co-parent as a partner", () => {
    const layout = layoutFamilyChart(people, relationships, "dad", { shape: "descendants" })!;
    expect(nodeFor(layout, "other")).toMatchObject({ role: "partner", generation: 0 });
    expect(nodeFor(layout, "mum")).toMatchObject({ role: "partner", generation: 0 });
    // Two partners: [first, person, second].
    const x = (id: string) => nodeFor(layout, id)!.x;
    expect(x("mum")).toBeLessThan(x("dad"));
    expect(x("dad")).toBeLessThan(x("other"));
    expect(x("half")).toBeGreaterThan(x("focus"));
    expectNoOverlaps(layout);
  });

  it("shows an unmarried co-parent only alongside the children that link them", () => {
    const layout = layoutFamilyChart(people, relationships, "focus")!;
    // Dad's other co-parent belongs to his half-son, who is not drawn in Dad's row.
    expect(nodeFor(layout, "other")).toBeUndefined();
    const collapsed = layoutFamilyChart(people, relationships, "dad", {
      shape: "descendants",
      descendantGenerations: 0
    })!;
    expect(nodeFor(collapsed, "mum")).toMatchObject({ role: "partner" });
    expect(nodeFor(collapsed, "other")).toBeUndefined();
  });

  it("shows only ancestors in pedigree mode", () => {
    const layout = layoutFamilyChart(people, relationships, "focus", { shape: "ancestors" })!;
    expect(ids(layout)).toEqual(["dad", "focus", "gm1", "gm2", "gp1", "gp2", "mum", "partner"].sort());
  });

  it("shows only descendants in descendants mode", () => {
    const layout = layoutFamilyChart(people, relationships, "focus", { shape: "descendants" })!;
    expect(ids(layout)).toEqual(["focus", "ggk", "grandkid", "kid1", "kid2", "partner"].sort());
  });

  it("limits generations each way", () => {
    const layout = layoutFamilyChart(people, relationships, "focus", {
      ancestorGenerations: 1,
      descendantGenerations: 1
    })!;
    expect(nodeFor(layout, "gp1")).toBeUndefined();
    expect(nodeFor(layout, "dad")).toMatchObject({ branch: "up", branchHidden: true });
    expect(nodeFor(layout, "kid1")).toMatchObject({ branch: "down", branchHidden: true });
    expect(nodeFor(layout, "grandkid")).toBeUndefined();
  });

  it("expands and collapses branches through the branch state", () => {
    let state = emptyFamilyChartBranchState;
    let layout = layoutFamilyChart(people, relationships, "focus", { branchState: state })!;

    // Siblings start with their descendants hidden.
    const older = nodeFor(layout, "older")!;
    expect(older).toMatchObject({ branch: "down", branchHidden: true });
    expect(nodeFor(layout, "olderKid")).toBeUndefined();
    state = toggleFamilyChartBranch(state, older);
    layout = layoutFamilyChart(people, relationships, "focus", { branchState: state })!;
    expect(nodeFor(layout, "olderKid")).toMatchObject({ generation: 1, role: "descendant" });

    // Expanding past the depth limit reveals more generations.
    state = toggleFamilyChartBranch(state, nodeFor(layout, "ggk")!);
    layout = layoutFamilyChart(people, relationships, "focus", { branchState: state })!;
    expect(nodeFor(layout, "gggk")).toMatchObject({ generation: 4 });

    // Collapsing a visible branch hides it; toggling again restores it.
    state = toggleFamilyChartBranch(state, nodeFor(layout, "kid1")!);
    layout = layoutFamilyChart(people, relationships, "focus", { branchState: state })!;
    expect(nodeFor(layout, "grandkid")).toBeUndefined();
    expect(nodeFor(layout, "kid1")).toMatchObject({ branchHidden: true });
    state = toggleFamilyChartBranch(state, nodeFor(layout, "kid1")!);
    layout = layoutFamilyChart(people, relationships, "focus", { branchState: state })!;
    expect(nodeFor(layout, "grandkid")).toBeDefined();

    state = toggleFamilyChartBranch(state, nodeFor(layout, "dad")!);
    layout = layoutFamilyChart(people, relationships, "focus", { branchState: state })!;
    expect(nodeFor(layout, "gp1")).toBeUndefined();
    expectNoOverlaps(layout);
  });

  it("handles pedigree collapse and cycles without looping or duplicating keys", () => {
    // Cousins who married: both parents descend from the same grandparents.
    const cousinPeople = ["g", "a", "b", "focus", "loop"].map((id) => person(id));
    const cousinRelationships = [
      ...parentOf("g", "a", "b"),
      ...parentOf("a", "focus"),
      ...parentOf("b", "focus"),
      ...parentOf("focus", "loop"),
      ...parentOf("loop", "g")
    ];
    const layout = layoutFamilyChart(cousinPeople, cousinRelationships, "focus", { shape: "ancestors" })!;
    const keys = layout.nodes.map((node) => node.key);
    expect(new Set(keys).size).toBe(keys.length);
    const gNodes = layout.nodes.filter((node) => node.personId === "g");
    expect(gNodes).toHaveLength(2);
    expect(gNodes.filter((node) => node.repeat)).toHaveLength(1);

    const hourglass = layoutFamilyChart(cousinPeople, cousinRelationships, "focus")!;
    const hourglassKeys = hourglass.nodes.map((node) => node.key);
    expect(new Set(hourglassKeys).size).toBe(hourglassKeys.length);
  });

  it("lays out a person with no relatives as a single card", () => {
    const layout = layoutFamilyChart([person("solo")], [], "solo")!;
    expect(layout.nodes).toEqual([
      expect.objectContaining({ personId: "solo", x: 0.5, generation: 0, role: "focus" })
    ]);
    expect(layout.width).toBe(1);
    expect(layout.edges).toEqual([]);
  });
});
