/**
 * @file Switch between the 3D graph and the simple 2D family tree in the Tree workspace.
 */

import {
  defaultGraphViewMode,
  graphViewModeSchema,
  type GraphViewMode,
  type UserPreferences
} from "@treemich/shared";
import { getLocalStorageItem, setLocalStorageItem } from "../../lib/safeLocalStorage";

/** Last view used on this device, so the right view mounts before preferences arrive. */
export const GRAPH_VIEW_MODE_STORAGE_KEY = "treemich.graphViewMode";

const options: Array<{ value: GraphViewMode; label: string }> = [
  { value: "familyChart", label: "Family tree" },
  { value: "graph3d", label: "3D graph" }
];

export const readCachedGraphViewMode = (): GraphViewMode | null => {
  const parsed = graphViewModeSchema.safeParse(getLocalStorageItem(GRAPH_VIEW_MODE_STORAGE_KEY));
  return parsed.success ? parsed.data : null;
};

export const cacheGraphViewMode = (mode: GraphViewMode) => {
  setLocalStorageItem(GRAPH_VIEW_MODE_STORAGE_KEY, mode);
};

/**
 * The Tree workspace surface: saved preference first, then this device's last choice
 * (while preferences are still loading), then the 3D graph.
 */
export const resolveGraphViewMode = (
  preferences: UserPreferences | null | undefined,
  cached: GraphViewMode | null = null
): GraphViewMode => preferences?.graphViewMode ?? cached ?? defaultGraphViewMode;

type Props = {
  value: GraphViewMode;
  onChange: (value: GraphViewMode) => void;
};

export const GraphViewToggle = ({ value, onChange }: Props) => (
  <div className="graph-view-toggle" role="group" aria-label="Tree view">
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        aria-pressed={value === option.value}
        className={value === option.value ? "is-active" : undefined}
        onClick={() => {
          if (value !== option.value) {
            onChange(option.value);
          }
        }}
      >
        {option.label}
      </button>
    ))}
  </div>
);
