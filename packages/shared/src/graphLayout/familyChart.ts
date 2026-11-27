/**
 * @file Focused 2D family chart layout (hourglass, pedigree, descendants) around one person.
 *
 * Unlike {@link positionGenerationTreePeople}, which places the whole graph in 3D, this lays out only the
 * family around a focus person on a flat grid: one row per generation, x measured in card "slots".
 * Only parent/child, spouse and sibling edges are read; other relationship kinds (friends, pets, and any
 * future non-family categories) are ignored, so callers can pass the full relationship list.
 */

import type { RelationshipType } from "../index.js";
import { buildParentChildIndex } from "./generationTree.js";

export const familyChartShapeValues = ["hourglass", "ancestors", "descendants"] as const;
export type FamilyChartShape = (typeof familyChartShapeValues)[number];

export const defaultFamilyChartShape: FamilyChartShape = "hourglass";
export const defaultFamilyChartGenerations = 3;
/** Generations revealed when a branch at the depth limit (or a sibling) is expanded. */
export const familyChartExpandStep = 3;
/** Extra spacing (in slots) between neighbouring family groups. */
export const familyChartGroupGap = 0.35;

export type FamilyChartPerson = {
  id: string;
  name: string;
  birthDate?: string | null;
  profile?: { gender?: string | null } | null;
};

export type FamilyChartRelationship = {
  fromPersonId: string;
  toPersonId: string;
  type: RelationshipType;
};

export type FamilyChartNodeRole = "focus" | "ancestor" | "descendant" | "partner" | "sibling";

export type FamilyChartNode = {
  /** Unique per chart; equals `personId` unless the person appears more than once (pedigree collapse). */
  key: string;
  personId: string;
  role: FamilyChartNodeRole;
  /** Slot-centre x (0 = left edge of the chart). */
  x: number;
  /** Generation relative to the focus: negative = ancestors, positive = descendants. */
  generation: number;
  /** True when this person is already drawn elsewhere in the chart; their branch is not repeated. */
  repeat: boolean;
  /** Direction of this card's expandable branch (parents above or children below), if it has one. */
  branch: "up" | "down" | null;
  /** The branch has people that are not drawn (depth limit, collapsed, or a sibling not yet expanded). */
  branchHidden: boolean;
};

export type FamilyChartEdge =
  | { kind: "couple"; key: string; fromKey: string; toKey: string }
  | { kind: "parents"; key: string; parentKeys: string[]; childKeys: string[] };

export type FamilyChartLayout = {
  focusPersonId: string;
  nodes: FamilyChartNode[];
  edges: FamilyChartEdge[];
  /** Total width in slots. */
  width: number;
  minGeneration: number;
  maxGeneration: number;
};

/** Per-person branch overrides, kept by the view and passed back into the layout. */
export type FamilyChartBranchState = {
  /** Branches hidden explicitly. */
  collapsed: readonly string[];
  /** Branches shown past the generation limit, and siblings whose descendants are shown. */
  expanded: readonly string[];
};

export const emptyFamilyChartBranchState: FamilyChartBranchState = { collapsed: [], expanded: [] };

export type FamilyChartOptions = {
  shape?: FamilyChartShape;
  ancestorGenerations?: number;
  descendantGenerations?: number;
  /** Show siblings beside the focus person (hourglass only). Default true. */
  includeSiblings?: boolean;
  branchState?: FamilyChartBranchState;
};

type Index = {
  parentsOf: (id: string) => string[];
  childrenOf: (id: string) => string[];
  spousesOf: (id: string) => string[];
  explicitSiblingsOf: (id: string) => string[];
};

type SubtreeNode = Omit<FamilyChartNode, "generation"> & { depth: number };
type Subtree = {
  width: number;
  /** Slot-centre x of the subtree's root person, relative to the subtree's left edge. */
  anchorX: number;
  rootKey: string;
  nodes: SubtreeNode[];
  edges: FamilyChartEdge[];
};

const birthSortKey = (person: FamilyChartPerson | undefined) => person?.birthDate || "9999";

const genderRank = (person: FamilyChartPerson | undefined) => {
  const gender = person?.profile?.gender;
  return gender === "MALE" ? 0 : gender === "FEMALE" ? 1 : 2;
};

const buildIndex = (
  people: readonly FamilyChartPerson[],
  relationships: readonly FamilyChartRelationship[]
): { index: Index; byId: Map<string, FamilyChartPerson> } => {
  const byId = new Map(people.map((person) => [person.id, person]));
  const { parentsByChild, childrenByParent } = buildParentChildIndex(relationships);
  const spouses = new Map<string, Set<string>>();
  const siblings = new Map<string, Set<string>>();
  const link = (map: Map<string, Set<string>>, a: string, b: string) => {
    map.set(a, (map.get(a) ?? new Set<string>()).add(b));
    map.set(b, (map.get(b) ?? new Set<string>()).add(a));
  };
  for (const relationship of relationships) {
    if (relationship.fromPersonId === relationship.toPersonId) {
      continue;
    }
    if (relationship.type === "SPOUSE_OF") {
      link(spouses, relationship.fromPersonId, relationship.toPersonId);
    } else if (relationship.type === "SIBLING_OF") {
      link(siblings, relationship.fromPersonId, relationship.toPersonId);
    }
  }
  const byName = (a: string, b: string) =>
    (byId.get(a)?.name ?? "").localeCompare(byId.get(b)?.name ?? "") || a.localeCompare(b);
  const byBirth = (a: string, b: string) =>
    birthSortKey(byId.get(a)).localeCompare(birthSortKey(byId.get(b))) || byName(a, b);
  const byParentOrder = (a: string, b: string) =>
    genderRank(byId.get(a)) - genderRank(byId.get(b)) || byName(a, b);
  const list = (set: Set<string> | undefined, compare: (a: string, b: string) => number) =>
    [...(set ?? [])].filter((id) => byId.has(id)).sort(compare);
  return {
    byId,
    index: {
      parentsOf: (id) => list(parentsByChild.get(id), byParentOrder).filter((parentId) => parentId !== id),
      childrenOf: (id) => list(childrenByParent.get(id), byBirth).filter((childId) => childId !== id),
      spousesOf: (id) => list(spouses.get(id), byName),
      explicitSiblingsOf: (id) => list(siblings.get(id), byBirth)
    }
  };
};

/** Places subtrees side by side with a gap; returns each one's left offset and the total width. */
const packSubtrees = (subtrees: readonly Subtree[]) => {
  const offsets: number[] = [];
  let cursor = 0;
  subtrees.forEach((subtree, i) => {
    cursor += i > 0 ? familyChartGroupGap : 0;
    offsets.push(cursor);
    cursor += subtree.width;
  });
  return { offsets, width: cursor };
};

const shift = (subtree: Subtree, dx: number): Subtree => ({
  ...subtree,
  anchorX: subtree.anchorX + dx,
  nodes: subtree.nodes.map((node) => ({ ...node, x: node.x + dx }))
});

const deeper = (subtree: Subtree) => subtree.nodes.map((node) => ({ ...node, depth: node.depth + 1 }));

/**
 * Builds a focused family chart around `focusPersonId`.
 * Returns `null` when the focus person is not in `people`.
 */
export const layoutFamilyChart = (
  people: readonly FamilyChartPerson[],
  relationships: readonly FamilyChartRelationship[],
  focusPersonId: string,
  options: FamilyChartOptions = {}
): FamilyChartLayout | null => {
  const { index, byId } = buildIndex(people, relationships);
  if (!byId.has(focusPersonId)) {
    return null;
  }
  const shape = options.shape ?? defaultFamilyChartShape;
  const ancestorGenerations = Math.max(0, options.ancestorGenerations ?? defaultFamilyChartGenerations);
  const descendantGenerations = Math.max(0, options.descendantGenerations ?? defaultFamilyChartGenerations);
  const includeSiblings = shape === "hourglass" && (options.includeSiblings ?? true);
  const collapsed = new Set(options.branchState?.collapsed ?? []);
  const expanded = new Set(options.branchState?.expanded ?? []);

  const placed = new Set<string>();
  const keyCounts = new Map<string, number>();
  const nextKey = (personId: string) => {
    const count = keyCounts.get(personId) ?? 0;
    keyCounts.set(personId, count + 1);
    return count === 0 ? personId : `${personId}~${count}`;
  };
  /** Generations left below/above this person after explicit collapse/expand. */
  const budgetFor = (personId: string, remaining: number) => {
    if (collapsed.has(personId)) {
      return 0;
    }
    return remaining <= 0 && expanded.has(personId) ? familyChartExpandStep : remaining;
  };

  /** Person + partners side by side, children (grouped by co-parent) one row below. */
  const layoutDown = (
    personId: string,
    budget: number,
    role: FamilyChartNodeRole,
    path: ReadonlySet<string>
  ): Subtree => {
    const key = nextKey(personId);
    const repeat = placed.has(personId);
    placed.add(personId);
    const children = repeat ? [] : index.childrenOf(personId).filter((id) => !path.has(id));
    const showChildren = budget > 0 && children.length > 0;
    // Partners: spouses, then other parents of the children shown (unmarried co-parents appear only
    // alongside the children that link them).
    const partners: string[] = [];
    if (!repeat) {
      const coParents = showChildren ? children.flatMap((childId) => index.parentsOf(childId)) : [];
      for (const id of [...index.spousesOf(personId), ...coParents]) {
        if (id !== personId && !path.has(id) && !partners.includes(id)) {
          partners.push(id);
        }
      }
    }
    const partnerKeys = partners.map((id) => {
      placed.add(id);
      return nextKey(id);
    });

    // Member order: one partner → [person, partner]; two or more → [first, person, rest...].
    const personSlot = partners.length >= 2 ? 1 : 0;
    const memberKeys = [...partnerKeys];
    memberKeys.splice(personSlot, 0, key);
    const memberIds = [...partners];
    memberIds.splice(personSlot, 0, personId);

    // Each child belongs to its first shown co-parent; groups follow member order so lines don't cross.
    const groups = new Map<number, string[]>();
    if (showChildren) {
      for (const childId of children) {
        const parents = index.parentsOf(childId);
        const coParentIndex = memberIds.findIndex((id) => id !== personId && parents.includes(id));
        const slot = coParentIndex === -1 ? personSlot : coParentIndex;
        groups.set(slot, [...(groups.get(slot) ?? []), childId]);
      }
    }
    const orderedGroups = [...groups.entries()].sort(([a], [b]) => a - b);
    const nextPath = new Set([...path, personId, ...partners]);
    const childSubtrees = orderedGroups.flatMap(([slot, childIds]) =>
      childIds.map((childId) => ({
        slot,
        subtree: layoutDown(childId, budgetFor(childId, budget - 1), "descendant", nextPath)
      }))
    );
    const packed = packSubtrees(childSubtrees.map((entry) => entry.subtree));
    const unitWidth = memberIds.length;
    const width = Math.max(unitWidth, packed.width);
    const childStart = (width - packed.width) / 2;
    const placedChildren = childSubtrees.map((entry, i) => ({
      slot: entry.slot,
      subtree: shift(entry.subtree, childStart + packed.offsets[i]!)
    }));

    let centre = width / 2;
    if (placedChildren.length > 0) {
      const first = placedChildren[0]!.subtree.anchorX;
      const last = placedChildren[placedChildren.length - 1]!.subtree.anchorX;
      centre = (first + last) / 2;
    }
    centre = Math.min(Math.max(centre, unitWidth / 2), width - unitWidth / 2);
    const memberX = (i: number) => centre - unitWidth / 2 + i + 0.5;

    const nodes: SubtreeNode[] = memberIds.map((id, i) =>
      id === personId
        ? {
            key,
            personId,
            role,
            x: memberX(i),
            depth: 0,
            repeat,
            branch: children.length > 0 ? "down" : null,
            branchHidden: children.length > 0 && !showChildren
          }
        : {
            key: memberKeys[i]!,
            personId: id,
            role: "partner",
            x: memberX(i),
            depth: 0,
            repeat: false,
            branch: null,
            branchHidden: false
          }
    );
    const edges: FamilyChartEdge[] = partnerKeys.map((partnerKey) => ({
      kind: "couple",
      key: `couple:${key}:${partnerKey}`,
      fromKey: key,
      toKey: partnerKey
    }));
    for (const [slot] of orderedGroups) {
      const parentKeys = slot === personSlot ? [key] : [key, memberKeys[slot]!];
      const childKeys = placedChildren
        .filter((entry) => entry.slot === slot)
        .map((entry) => entry.subtree.rootKey);
      edges.push({ kind: "parents", key: `parents:${parentKeys.join("+")}`, parentKeys, childKeys });
    }
    for (const { subtree } of placedChildren) {
      nodes.push(...deeper(subtree));
      edges.push(...subtree.edges);
    }
    return { width, anchorX: memberX(personSlot), rootKey: key, nodes, edges };
  };

  /**
   * Ancestor tree rooted at `personId`; parents sit one row up, centred over their child.
   * The root itself is not emitted (generation 0 is drawn by {@link layoutDown}).
   */
  const layoutUp = (
    personId: string,
    budget: number,
    path: ReadonlySet<string>,
    isRoot: boolean
  ): Subtree => {
    const key = isRoot ? personId : nextKey(personId);
    const repeat = !isRoot && placed.has(personId);
    placed.add(personId);
    const parents = repeat ? [] : index.parentsOf(personId).filter((id) => !path.has(id));
    const showParents = budget > 0 && parents.length > 0;
    const nextPath = new Set([...path, personId]);
    const parentSubtrees = showParents
      ? parents.map((parentId) => layoutUp(parentId, budgetFor(parentId, budget - 1), nextPath, false))
      : [];
    const packed = packSubtrees(parentSubtrees);
    const width = Math.max(1, packed.width);
    const placedParents = parentSubtrees.map((subtree, i) =>
      shift(subtree, (width - packed.width) / 2 + packed.offsets[i]!)
    );
    const anchorX =
      placedParents.length > 0
        ? (placedParents[0]!.anchorX + placedParents[placedParents.length - 1]!.anchorX) / 2
        : width / 2;

    const nodes: SubtreeNode[] = isRoot
      ? []
      : [
          {
            key,
            personId,
            role: "ancestor",
            x: anchorX,
            depth: 0,
            repeat,
            branch: parents.length > 0 ? "up" : null,
            branchHidden: parents.length > 0 && !showParents
          }
        ];
    const edges: FamilyChartEdge[] = [];
    for (let i = 1; i < placedParents.length; i += 1) {
      const fromKey = placedParents[i - 1]!.rootKey;
      const toKey = placedParents[i]!.rootKey;
      edges.push({ kind: "couple", key: `couple:${fromKey}:${toKey}`, fromKey, toKey });
    }
    if (!isRoot && placedParents.length > 0) {
      const parentKeys = placedParents.map((subtree) => subtree.rootKey);
      edges.push({
        kind: "parents",
        key: `parents:${parentKeys.join("+")}:${key}`,
        parentKeys,
        childKeys: [key]
      });
    }
    for (const subtree of placedParents) {
      nodes.push(...deeper(subtree));
      edges.push(...subtree.edges);
    }
    return { width, anchorX, rootKey: key, nodes, edges };
  };

  const focusParents = index.parentsOf(focusPersonId);

  // Ancestors first, so blood relatives keep their plain keys and are flagged as repeats elsewhere.
  const upTree =
    shape === "descendants" ? null : layoutUp(focusPersonId, ancestorGenerations, new Set(), true);
  placed.delete(focusPersonId);

  // Generation 0: the focus (with partners and descendants) and, in hourglass mode, siblings.
  const siblingIds: string[] = [];
  if (includeSiblings) {
    const candidates = [
      ...focusParents.flatMap((parentId) => index.childrenOf(parentId)),
      ...index.explicitSiblingsOf(focusPersonId)
    ];
    for (const id of candidates) {
      if (id !== focusPersonId && !siblingIds.includes(id)) {
        siblingIds.push(id);
      }
    }
  }
  const rowIds = [focusPersonId, ...siblingIds].sort(
    (a, b) =>
      birthSortKey(byId.get(a)).localeCompare(birthSortKey(byId.get(b))) ||
      (byId.get(a)?.name ?? "").localeCompare(byId.get(b)?.name ?? "") ||
      a.localeCompare(b)
  );
  // Lay out the focus before siblings so it keeps the plain key, then place everyone in birth order.
  const rowPath = new Set(focusParents);
  const focusTree = layoutDown(
    focusPersonId,
    shape === "ancestors" ? 0 : descendantGenerations,
    "focus",
    rowPath
  );
  const siblingPath = new Set([...rowPath, focusPersonId]);
  const rowSubtrees = rowIds.map((id) => {
    if (id === focusPersonId) {
      return focusTree;
    }
    // Siblings start with their descendants hidden; expanding shows a few generations.
    const budget = expanded.has(id) && !collapsed.has(id) ? familyChartExpandStep : 0;
    return layoutDown(id, budget, "sibling", siblingPath);
  });
  const packedRow = packSubtrees(rowSubtrees);
  const row = rowSubtrees.map((subtree, i) => shift(subtree, packedRow.offsets[i]!));

  const nodes: FamilyChartNode[] = [];
  const edges: FamilyChartEdge[] = [];
  for (const subtree of row) {
    nodes.push(...subtree.nodes.map(({ depth, ...node }) => ({ ...node, generation: depth })));
    edges.push(...subtree.edges);
  }
  // The focus never collapses: it is the chart's anchor.
  const focusNode = nodes.find((node) => node.key === focusPersonId)!;
  focusNode.branch = null;
  focusNode.branchHidden = false;

  if (upTree && upTree.nodes.length > 0) {
    // Centre the parents over the focus and the full siblings who share all of the focus's parents.
    const fullSiblingXs = row
      .filter((_, i) => {
        const id = rowIds[i]!;
        const parents = index.parentsOf(id);
        return id === focusPersonId || focusParents.every((parentId) => parents.includes(parentId));
      })
      .map((subtree) => subtree.anchorX);
    const target = (Math.min(...fullSiblingXs) + Math.max(...fullSiblingXs)) / 2;
    const dx = target - upTree.anchorX;
    nodes.push(
      ...upTree.nodes.map(({ depth, ...node }) => ({ ...node, x: node.x + dx, generation: -depth }))
    );
    edges.push(...upTree.edges);

    // One connector per distinct set of shown parents (full siblings vs half siblings).
    const parentKeyByPerson = new Map(
      upTree.nodes.filter((node) => node.depth === 1).map((node) => [node.personId, node.key])
    );
    const groups = new Map<string, { parentKeys: string[]; childKeys: string[] }>();
    row.forEach((subtree, i) => {
      const parentKeys = index
        .parentsOf(rowIds[i]!)
        .map((parentId) => parentKeyByPerson.get(parentId))
        .filter((parentKey): parentKey is string => Boolean(parentKey));
      if (parentKeys.length === 0) {
        return;
      }
      const groupKey = parentKeys.join("+");
      const group = groups.get(groupKey) ?? { parentKeys, childKeys: [] };
      group.childKeys.push(subtree.rootKey);
      groups.set(groupKey, group);
    });
    for (const [groupKey, group] of groups) {
      edges.push({ kind: "parents", key: `parents:${groupKey}:focus-row`, ...group });
    }
  }

  const minX = Math.min(...nodes.map((node) => node.x - 0.5));
  const maxX = Math.max(...nodes.map((node) => node.x + 0.5));
  const generations = nodes.map((node) => node.generation);
  return {
    focusPersonId,
    nodes: nodes.map((node) => ({ ...node, x: node.x - minX })),
    edges,
    width: maxX - minX,
    minGeneration: Math.min(...generations),
    maxGeneration: Math.max(...generations)
  };
};

/**
 * Next branch state after the user toggles a card's expand/collapse control.
 * Hidden branches are revealed (clearing an explicit collapse, or expanding past the depth limit);
 * visible ones are collapsed.
 */
export const toggleFamilyChartBranch = (
  state: FamilyChartBranchState,
  node: Pick<FamilyChartNode, "personId" | "branchHidden">
): FamilyChartBranchState => {
  const without = (list: readonly string[]) => list.filter((id) => id !== node.personId);
  if (node.branchHidden) {
    return state.collapsed.includes(node.personId)
      ? { collapsed: without(state.collapsed), expanded: state.expanded }
      : { collapsed: state.collapsed, expanded: [...without(state.expanded), node.personId] };
  }
  return { collapsed: [...without(state.collapsed), node.personId], expanded: without(state.expanded) };
};
