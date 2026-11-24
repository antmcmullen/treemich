import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreatePersonBody, FamilyChartShape } from "@treemich/shared";
import type { Person, RelationshipRecord, RelationshipType } from "../../lib/api";
import { FamilyChartView, formatLifeYears } from "./FamilyChartView";

const reactTestEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

// Made-up people only.
const makePerson = (id: string, name: string, birthDate: string | null = null): Person => ({
  id,
  name,
  birthDate
});

const seedPeople: Person[] = [
  makePerson("ada", "Ada Example", "1930-04-02"),
  makePerson("ben", "Ben Example", "1928"),
  makePerson("cara", "Cara Example", "1960"),
  makePerson("dev", "Dev Sample", "1959"),
  makePerson("eli", "Eli Example", "1990"),
  makePerson("finn", "Finn Example", "1962"),
  makePerson("gus", "Gus Example", "1988"),
  makePerson("pal", "Pal Friend")
];

const edge = (fromPersonId: string, type: RelationshipType, toPersonId: string): RelationshipRecord => ({
  fromPersonId,
  toPersonId,
  type
});

const seedRelationships: RelationshipRecord[] = [
  edge("ada", "SPOUSE_OF", "ben"),
  edge("ada", "PARENT_OF", "cara"),
  edge("ben", "PARENT_OF", "cara"),
  edge("ada", "PARENT_OF", "finn"),
  edge("ben", "PARENT_OF", "finn"),
  edge("finn", "PARENT_OF", "gus"),
  edge("cara", "SPOUSE_OF", "dev"),
  edge("cara", "PARENT_OF", "eli"),
  edge("dev", "PARENT_OF", "eli"),
  edge("cara", "FRIEND_OF", "pal")
];

type HarnessProps = {
  initialSelected?: string | null;
  initialShape?: FamilyChartShape;
  onOpenPerson?: (id: string) => void;
  createPersonSpy?: (body: CreatePersonBody) => void;
  createRelationshipSpy?: (source: string, target: string, type: RelationshipType) => void;
};

/** Mirrors PeopleGraphDataContext: created people and relationships merge into state (no refetch). */
const Harness = ({
  initialSelected = "cara",
  initialShape = "hourglass",
  onOpenPerson = () => undefined,
  createPersonSpy,
  createRelationshipSpy
}: HarnessProps) => {
  const [people, setPeople] = useState(seedPeople);
  const [relationships, setRelationships] = useState(seedRelationships);
  const [selected, setSelected] = useState<string | null>(initialSelected);
  const [shape, setShape] = useState<FamilyChartShape>(initialShape);
  return (
    <FamilyChartView
      people={people}
      relationships={relationships}
      selectedPersonId={selected}
      shape={shape}
      isLoading={false}
      loadError={null}
      isSavingRelationship={false}
      onShapeChange={setShape}
      onSelectPerson={setSelected}
      onOpenPerson={onOpenPerson}
      onCreatePerson={async (body) => {
        createPersonSpy?.(body);
        const created = makePerson("new-1", [body.givenName, body.surname].filter(Boolean).join(" "));
        setPeople((current) => [...current, created]);
        return created;
      }}
      onCreateRelationship={async (source, target, type) => {
        createRelationshipSpy?.(source, target, type);
        setRelationships((current) => [...current, edge(source, type, target)]);
      }}
    />
  );
};

describe("formatLifeYears", () => {
  it("formats birth and death years", () => {
    expect(formatLifeYears({ birthDate: "1930-04-02", deathDate: "2001" })).toBe("1930–2001");
    expect(formatLifeYears({ birthDate: "1930" })).toBe("b. 1930");
    expect(formatLifeYears({ birthDate: null, deathDate: "2001-01-01" })).toBe("d. 2001");
    expect(formatLifeYears({ birthDate: null })).toBe("");
    expect(formatLifeYears({ birthDate: null, birthYear: 1921, deathYear: 1994 })).toBe("1921–1994");
    expect(formatLifeYears({ birthDate: "1930-04-02", birthYear: 1929 })).toBe("b. 1929");
  });
});

describe("FamilyChartView", () => {
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
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  const render = (props: HarnessProps = {}) => {
    act(() => {
      root.render(<Harness {...props} />);
    });
  };
  const card = (personId: string) =>
    container.querySelector<HTMLElement>(`.family-chart-card[data-person-id="${personId}"]`);
  const shownIds = () =>
    [...container.querySelectorAll<HTMLElement>(".family-chart-card")]
      .map((el) => el.dataset.personId)
      .sort();
  const buttonByText = (text: string) =>
    [...container.querySelectorAll("button")].find((button) => button.textContent === text);
  const click = async (element: Element | null | undefined) => {
    expect(element).toBeTruthy();
    await act(async () => {
      (element as HTMLElement).click();
    });
  };

  it("shows parents, partner, siblings and children around the selected person, but not friends", () => {
    render();
    expect(shownIds()).toEqual(["ada", "ben", "cara", "dev", "eli", "finn"]);
    expect(card("cara")?.className).toContain("family-chart-card--focus");
    expect(card("cara")?.textContent).toContain("Cara Example");
    expect(card("cara")?.textContent).toContain("b. 1960");
    // Ancestors sit above the focus row, children below.
    const top = (id: string) => Number.parseFloat(card(id)!.style.top);
    expect(top("ada")).toBeLessThan(top("cara"));
    expect(top("eli")).toBeGreaterThan(top("cara"));
    expect(top("dev")).toBe(top("cara"));
    expect(container.querySelectorAll(".family-chart-line").length).toBeGreaterThan(0);
  });

  it("re-centres on a clicked relative and opens details for the centred person", async () => {
    const onOpenPerson = vi.fn();
    render({ onOpenPerson });

    await click(card("ada")?.querySelector(".family-chart-card-main"));
    expect(card("ada")?.className).toContain("family-chart-card--focus");
    expect(onOpenPerson).not.toHaveBeenCalled();

    await click(card("ada")?.querySelector(".family-chart-card-main"));
    expect(onOpenPerson).toHaveBeenCalledWith("ada");
  });

  it("switches between hourglass, ancestors and descendants", async () => {
    render();
    await click(buttonByText("Ancestors"));
    expect(buttonByText("Ancestors")?.getAttribute("aria-pressed")).toBe("true");
    expect(shownIds()).toEqual(["ada", "ben", "cara", "dev"]);

    await click(buttonByText("Descendants"));
    expect(shownIds()).toEqual(["cara", "dev", "eli"]);
  });

  it("expands a sibling's family and collapses it again", async () => {
    render();
    expect(card("gus")).toBeNull();
    const toggle = card("finn")?.querySelector(".family-chart-branch-toggle");
    expect(toggle?.getAttribute("aria-label")).toBe("Show children of Finn Example");

    await click(toggle);
    expect(card("gus")).not.toBeNull();

    await click(card("finn")?.querySelector(".family-chart-branch-toggle"));
    expect(card("gus")).toBeNull();
  });

  it("adds a new child from a card and shows them straight away", async () => {
    const createPersonSpy = vi.fn();
    const createRelationshipSpy = vi.fn();
    render({ createPersonSpy, createRelationshipSpy });

    await click(card("cara")?.querySelector(".family-chart-add-button"));
    await click(buttonByText("Add child"));

    const input = container.querySelector('input[list="add-relative-options"]') as HTMLInputElement;
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      valueSetter.call(input, "Hana Example");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(
      [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Create & Add"))
    );

    expect(createPersonSpy).toHaveBeenCalledWith(
      expect.objectContaining({ givenName: "Hana", surname: "Example" })
    );
    expect(createRelationshipSpy).toHaveBeenCalledWith("cara", "new-1", "PARENT_OF");
    expect(card("new-1")?.textContent).toContain("Hana Example");
    expect(container.textContent).toContain("Created and added Hana Example");
  });

  it("asks for a person to centre on when nothing is selected", async () => {
    render({ initialSelected: null });
    const select = container.querySelector("select") as HTMLSelectElement;
    expect(select).not.toBeNull();
    await act(async () => {
      select.value = "eli";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(card("eli")?.className).toContain("family-chart-card--focus");
  });
});
