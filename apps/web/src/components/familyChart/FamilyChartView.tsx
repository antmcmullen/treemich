/**
 * @file Simple 2D family chart: a readable alternative to the 3D graph, focused on the selected person.
 */

import {
  emptyFamilyChartBranchState,
  familyChartShapeValues,
  layoutFamilyChart,
  toggleFamilyChartBranch,
  type CreatePersonBody,
  type FamilyChartBranchState,
  type FamilyChartEdge,
  type FamilyChartLayout,
  type FamilyChartNode,
  type FamilyChartShape
} from "@treemich/shared";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, PointerEvent as ReactPointerEvent } from "react";
import {
  personThumbnailUrl,
  type Person,
  type RelationshipRecord,
  type RelationshipType
} from "../../lib/api";
import { getPersonDisplayLabel } from "../../lib/personDisplay";
import { AddRelativePopup, type AddRelativeSubmitPayload } from "../graph/AddRelativePopup";
import type { AddRelativeSlot } from "../graph/NodeActionButtons";
import { submitAddRelative } from "../graph/addRelativeSubmit";

export const FAMILY_CHART_CARD_WIDTH = 176;
export const FAMILY_CHART_CARD_HEIGHT = 76;
const SLOT_WIDTH = FAMILY_CHART_CARD_WIDTH + 28;
const ROW_HEIGHT = FAMILY_CHART_CARD_HEIGHT + 76;
const PADDING = 48;
const ZOOM_STEPS = [0.5, 0.65, 0.8, 1, 1.2, 1.45];
const DEFAULT_ZOOM_INDEX = 3;

const shapeLabels: Record<FamilyChartShape, string> = {
  hourglass: "Hourglass",
  ancestors: "Ancestors",
  descendants: "Descendants"
};

const slotLabels: Record<AddRelativeSlot, string> = {
  parent: "Add parent",
  siblingOrSpouse: "Add partner or sibling",
  child: "Add child"
};

type Props = {
  people: Person[];
  relationships: RelationshipRecord[];
  selectedPersonId: string | null;
  shape: FamilyChartShape;
  isLoading: boolean;
  loadError: string | null;
  isSavingRelationship: boolean;
  onShapeChange: (shape: FamilyChartShape) => void;
  onSelectPerson: (personId: string) => void;
  onOpenPerson: (personId: string) => void;
  onCreatePerson: (body: CreatePersonBody) => Promise<Person>;
  onCreateRelationship: (
    sourcePersonId: string,
    targetPersonId: string,
    type: RelationshipType
  ) => Promise<void>;
  onNewPerson?: () => void;
};

type CardPosition = { left: number; top: number };

const cardPosition = (
  node: Pick<FamilyChartNode, "x" | "generation">,
  minGeneration: number
): CardPosition => ({
  left: PADDING + node.x * SLOT_WIDTH - FAMILY_CHART_CARD_WIDTH / 2,
  top: PADDING + (node.generation - minGeneration) * ROW_HEIGHT
});

const yearOf = (value: string | null | undefined) => {
  const match = value?.match(/^\s*(\d{3,4})/);
  return match ? Number(match[1]) : null;
};

type LifeYearsInput = Pick<Person, "birthDate" | "birthYear" | "deathYear"> & { deathDate?: string | null };

/** Birth year from the life-event summary, falling back to a stored birth date. */
const birthYearOf = (person: LifeYearsInput) => person.birthYear ?? yearOf(person.birthDate);

/** "1932–2010", "b. 1960", "d. 2010" or "" from the person's birth and death years. */
export const formatLifeYears = (person: LifeYearsInput) => {
  const birth = birthYearOf(person);
  const death = person.deathYear ?? yearOf(person.deathDate);
  if (birth && death) {
    return `${birth}–${death}`;
  }
  if (birth) {
    return `b. ${birth}`;
  }
  return death ? `d. ${death}` : "";
};

const initialsOf = (label: string) =>
  label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");

/** SVG path for one parent→children connector (drop from parents, bus, drops to each child). */
const connectorPath = (
  edge: Extract<FamilyChartEdge, { kind: "parents" }>,
  positions: Map<string, CardPosition>
) => {
  const parents = edge.parentKeys
    .map((key) => positions.get(key))
    .filter((p): p is CardPosition => Boolean(p));
  const children = edge.childKeys
    .map((key) => positions.get(key))
    .filter((p): p is CardPosition => Boolean(p));
  if (parents.length === 0 || children.length === 0) {
    return null;
  }
  const centreX = (position: CardPosition) => position.left + FAMILY_CHART_CARD_WIDTH / 2;
  const parentX = parents.reduce((sum, position) => sum + centreX(position), 0) / parents.length;
  // Two parents: drop from the middle of the couple line; one parent: from the bottom of the card.
  const startY =
    parents.length > 1
      ? parents[0]!.top + FAMILY_CHART_CARD_HEIGHT / 2
      : parents[0]!.top + FAMILY_CHART_CARD_HEIGHT;
  const childTop = Math.min(...children.map((position) => position.top));
  const busY = childTop - (ROW_HEIGHT - FAMILY_CHART_CARD_HEIGHT) / 2;
  const xs = [parentX, ...children.map(centreX)];
  const segments = [
    `M ${parentX} ${startY} V ${busY}`,
    `M ${Math.min(...xs)} ${busY} H ${Math.max(...xs)}`,
    ...children.map((position) => `M ${centreX(position)} ${busY} V ${position.top}`)
  ];
  return segments.join(" ");
};

type CardProps = {
  node: FamilyChartNode;
  person: Person;
  position: CardPosition;
  menuOpen: boolean;
  onSelect: (personId: string) => void;
  onOpen: (personId: string) => void;
  onToggleBranch: (node: FamilyChartNode) => void;
  onToggleMenu: (key: string | null) => void;
  onAddRelative: (personId: string, slot: AddRelativeSlot) => void;
};

const FamilyChartCard = memo(
  ({
    node,
    person,
    position,
    menuOpen,
    onSelect,
    onOpen,
    onToggleBranch,
    onToggleMenu,
    onAddRelative
  }: CardProps) => {
    const label = getPersonDisplayLabel(person);
    const years = formatLifeYears(person);
    const isFocus = node.role === "focus";
    const branchLabel =
      node.branch === "up"
        ? `${node.branchHidden ? "Show" : "Hide"} parents of ${label}`
        : `${node.branchHidden ? "Show" : "Hide"} children of ${label}`;
    return (
      <div
        className={`family-chart-card family-chart-card--${node.role}${node.repeat ? " family-chart-card--repeat" : ""}`}
        style={{
          left: position.left,
          top: position.top,
          width: FAMILY_CHART_CARD_WIDTH,
          height: FAMILY_CHART_CARD_HEIGHT
        }}
        data-person-id={person.id}
        data-node-key={node.key}
      >
        <button
          type="button"
          className="family-chart-card-main"
          aria-current={isFocus ? "true" : undefined}
          aria-label={`${label}${years ? `, ${years}` : ""}${isFocus ? " (centred)" : ""}`}
          title={isFocus ? "Double-click to open details" : "Click to centre the tree on this person"}
          onClick={() => (isFocus ? onOpen(person.id) : onSelect(person.id))}
          onDoubleClick={() => onOpen(person.id)}
        >
          <span className="family-chart-avatar" aria-hidden="true">
            {person.thumbnail ? (
              <img src={personThumbnailUrl(person.id)} alt="" loading="lazy" draggable={false} />
            ) : (
              initialsOf(label)
            )}
          </span>
          <span className="family-chart-text">
            <span className="family-chart-name">{label}</span>
            {years ? <span className="family-chart-years">{years}</span> : null}
            {node.repeat ? <span className="family-chart-years">Shown elsewhere</span> : null}
          </span>
        </button>
        <button
          type="button"
          className="family-chart-mini-button family-chart-add-button"
          aria-label={`Add a relative to ${label}`}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          onClick={() => onToggleMenu(menuOpen ? null : node.key)}
        >
          +
        </button>
        {menuOpen ? (
          <div className="family-chart-add-menu" role="menu" aria-label={`Add a relative to ${label}`}>
            {(Object.keys(slotLabels) as AddRelativeSlot[]).map((slot) => (
              <button
                key={slot}
                type="button"
                role="menuitem"
                onClick={() => {
                  onToggleMenu(null);
                  onAddRelative(person.id, slot);
                }}
              >
                {slotLabels[slot]}
              </button>
            ))}
          </div>
        ) : null}
        {node.branch ? (
          <button
            type="button"
            className={`family-chart-mini-button family-chart-branch-toggle family-chart-branch-toggle--${node.branch}`}
            aria-label={branchLabel}
            aria-expanded={!node.branchHidden}
            title={branchLabel}
            onClick={() => onToggleBranch(node)}
          >
            {node.branchHidden ? "+" : "−"}
          </button>
        ) : null}
      </div>
    );
  }
);

export const FamilyChartView = ({
  people,
  relationships,
  selectedPersonId,
  shape,
  isLoading,
  loadError,
  isSavingRelationship,
  onShapeChange,
  onSelectPerson,
  onOpenPerson,
  onCreatePerson,
  onCreateRelationship,
  onNewPerson
}: Props) => {
  const [branchState, setBranchState] = useState<FamilyChartBranchState>(emptyFamilyChartBranchState);
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const [addIntent, setAddIntent] = useState<{ personId: string; slot: AddRelativeSlot } | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);

  const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);
  const focusPersonId = selectedPersonId && peopleById.has(selectedPersonId) ? selectedPersonId : null;

  // Expansions are relative to the current focus; start fresh when the focus changes.
  useEffect(() => {
    setBranchState(emptyFamilyChartBranchState);
    setMenuKey(null);
  }, [focusPersonId, shape]);

  const layout = useMemo<FamilyChartLayout | null>(
    () =>
      focusPersonId
        ? layoutFamilyChart(
            people.map((person) => {
              const birthYear = birthYearOf(person);
              return {
                ...person,
                name: getPersonDisplayLabel(person),
                // Sibling and child order uses this; a year is enough.
                birthDate: person.birthDate ?? (birthYear ? String(birthYear) : null)
              };
            }),
            relationships,
            focusPersonId,
            { shape, branchState }
          )
        : null,
    [people, relationships, focusPersonId, shape, branchState]
  );

  const positions = useMemo(() => {
    const map = new Map<string, CardPosition>();
    for (const node of layout?.nodes ?? []) {
      map.set(node.key, cardPosition(node, layout!.minGeneration));
    }
    return map;
  }, [layout]);

  const zoom = ZOOM_STEPS[zoomIndex]!;
  const canvasWidth = layout ? layout.width * SLOT_WIDTH + PADDING * 2 : 0;
  const canvasHeight = layout
    ? (layout.maxGeneration - layout.minGeneration) * ROW_HEIGHT + FAMILY_CHART_CARD_HEIGHT + PADDING * 2
    : 0;

  // Keep the focus card centred in view when the focus, shape or zoom changes.
  const focusPosition = focusPersonId ? positions.get(focusPersonId) : undefined;
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !focusPosition) {
      return;
    }
    const left = (focusPosition.left + FAMILY_CHART_CARD_WIDTH / 2) * zoom - viewport.clientWidth / 2;
    const top = (focusPosition.top + FAMILY_CHART_CARD_HEIGHT / 2) * zoom - viewport.clientHeight / 2;
    if (typeof viewport.scrollTo === "function") {
      viewport.scrollTo({ left: Math.max(0, left), top: Math.max(0, top) });
    }
    // Only re-centre on focus/shape/zoom changes, not on every expand/collapse.
  }, [focusPersonId, shape, zoom]);

  const handleToggleBranch = useCallback((node: FamilyChartNode) => {
    setBranchState((current) => toggleFamilyChartBranch(current, node));
  }, []);

  const handleAddRelative = useCallback((personId: string, slot: AddRelativeSlot) => {
    setFeedback(null);
    setAddIntent({ personId, slot });
  }, []);

  const handleSubmitAddRelative = async (payload: AddRelativeSubmitPayload) => {
    if (!addIntent) {
      return;
    }
    const message = await submitAddRelative({
      payload,
      slot: addIntent.slot,
      anchorPersonId: addIntent.personId,
      people,
      onCreatePerson,
      onCreateRelationship
    });
    setAddIntent(null);
    setFeedback(message);
  };

  // Drag the empty background to pan.
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    if (!viewport || event.button !== 0 || (event.target as HTMLElement).closest("button, [role='menu']")) {
      return;
    }
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
      moved: false
    };
    viewport.setPointerCapture?.(event.pointerId);
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const viewport = viewportRef.current;
    if (!drag || !viewport) {
      return;
    }
    drag.moved = true;
    viewport.scrollLeft = drag.left - (event.clientX - drag.x);
    viewport.scrollTop = drag.top - (event.clientY - drag.y);
  };
  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current) {
      viewportRef.current?.releasePointerCapture?.(event.pointerId);
      dragRef.current = null;
    }
  };

  const anchorPerson = addIntent ? peopleById.get(addIntent.personId) : undefined;
  const popupPeople = useMemo(
    () => people.map((person) => ({ id: person.id, name: getPersonDisplayLabel(person) })),
    [people]
  );

  let body: ReactNode;
  if (loadError) {
    body = <p className="family-chart-empty">Could not load the tree: {loadError}</p>;
  } else if (isLoading && people.length === 0) {
    body = <p className="family-chart-empty">Loading the tree…</p>;
  } else if (people.length === 0) {
    body = (
      <div className="family-chart-empty">
        <p>No people yet.</p>
        {onNewPerson ? (
          <button type="button" className="secondary-button" onClick={onNewPerson}>
            Add your first person
          </button>
        ) : null}
      </div>
    );
  } else if (!layout) {
    body = (
      <div className="family-chart-empty">
        <label>
          <span>Choose someone to centre the tree on</span>
          <select
            value=""
            onChange={(event) => {
              if (event.target.value) {
                onSelectPerson(event.target.value);
              }
            }}
          >
            <option value="">Select a person…</option>
            {popupPeople.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    );
  } else {
    body = (
      <div
        ref={viewportRef}
        className="family-chart-viewport"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div
          className="family-chart-zoom-frame"
          style={{ width: canvasWidth * zoom, height: canvasHeight * zoom }}
        >
          <div
            className="family-chart-canvas"
            style={{ width: canvasWidth, height: canvasHeight, transform: `scale(${zoom})` }}
          >
            <svg className="family-chart-lines" width={canvasWidth} height={canvasHeight} aria-hidden="true">
              {layout.edges.map((edge) => {
                if (edge.kind === "couple") {
                  const from = positions.get(edge.fromKey);
                  const to = positions.get(edge.toKey);
                  if (!from || !to) {
                    return null;
                  }
                  const [left, right] = from.left <= to.left ? [from, to] : [to, from];
                  const y = left.top + FAMILY_CHART_CARD_HEIGHT / 2;
                  return (
                    <path
                      key={edge.key}
                      className="family-chart-line family-chart-line--couple"
                      d={`M ${left.left + FAMILY_CHART_CARD_WIDTH} ${y} H ${right.left}`}
                    />
                  );
                }
                const d = connectorPath(edge, positions);
                return d ? <path key={edge.key} className="family-chart-line" d={d} /> : null;
              })}
            </svg>
            {layout.nodes.map((node) => {
              const person = peopleById.get(node.personId);
              const position = positions.get(node.key);
              if (!person || !position) {
                return null;
              }
              return (
                <FamilyChartCard
                  key={node.key}
                  node={node}
                  person={person}
                  position={position}
                  menuOpen={menuKey === node.key}
                  onSelect={onSelectPerson}
                  onOpen={onOpenPerson}
                  onToggleBranch={handleToggleBranch}
                  onToggleMenu={setMenuKey}
                  onAddRelative={handleAddRelative}
                />
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <section className="card graph-card family-chart" aria-label="Family tree">
      <div className="graph-surface family-chart-surface">
        <div className="family-chart-toolbar">
          <div className="family-chart-segmented" role="group" aria-label="Tree shape">
            {familyChartShapeValues.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={shape === value}
                className={shape === value ? "is-active" : undefined}
                onClick={() => onShapeChange(value)}
              >
                {shapeLabels[value]}
              </button>
            ))}
          </div>
          {layout ? (
            <div className="family-chart-zoom" role="group" aria-label="Zoom">
              <button
                type="button"
                aria-label="Zoom out"
                disabled={zoomIndex === 0}
                onClick={() => setZoomIndex((index) => Math.max(0, index - 1))}
              >
                −
              </button>
              <button type="button" aria-label="Reset zoom" onClick={() => setZoomIndex(DEFAULT_ZOOM_INDEX)}>
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                aria-label="Zoom in"
                disabled={zoomIndex === ZOOM_STEPS.length - 1}
                onClick={() => setZoomIndex((index) => Math.min(ZOOM_STEPS.length - 1, index + 1))}
              >
                +
              </button>
            </div>
          ) : null}
        </div>
        {body}
        {onNewPerson && layout ? (
          <button type="button" className="secondary-button family-chart-new-person" onClick={onNewPerson}>
            Add Person
          </button>
        ) : null}
        {feedback ? (
          <p className="family-chart-feedback" role="status">
            {feedback}
          </p>
        ) : null}
        {addIntent && anchorPerson ? (
          <AddRelativePopup
            slot={addIntent.slot}
            selectedPersonName={getPersonDisplayLabel(anchorPerson)}
            people={popupPeople}
            busy={isSavingRelationship}
            onCancel={() => setAddIntent(null)}
            onSubmit={handleSubmitAddRelative}
          />
        ) : null}
      </div>
    </section>
  );
};
