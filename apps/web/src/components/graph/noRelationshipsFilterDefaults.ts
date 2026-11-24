/**
 * @file Graph layer defaults for trees that start with no relationships.
 *
 * A tree with no relationships (and no saved layer choice) opens with every relationship layer off.
 * Once relationships arrive in the same page session (GEDCOM import, add relative, Immich import),
 * those layers must come back on, or the new lines stay hidden until a page reload.
 */

import type { GraphFilterVisibility } from "./relationshipStyles";

const sameVisibility = (left: GraphFilterVisibility, right: GraphFilterVisibility) =>
  (Object.keys(right) as (keyof GraphFilterVisibility)[]).every((key) => left[key] === right[key]);

/**
 * Returns the layer visibility to use after the "no relationships" default changes, or `null` to keep
 * the current one. Layers are only restored when the default switched off (relationships appeared) and
 * the viewer is still on the untouched no-relationships state, so a layer the user changed stays as is.
 */
export const resolveFilterVisibilityWhenRelationshipsArrive = ({
  wasNoRelationshipsDefault,
  isNoRelationshipsDefault,
  currentVisibility,
  noRelationshipsVisibility,
  defaultVisibility
}: {
  wasNoRelationshipsDefault: boolean;
  isNoRelationshipsDefault: boolean;
  currentVisibility: GraphFilterVisibility;
  noRelationshipsVisibility: GraphFilterVisibility;
  defaultVisibility: GraphFilterVisibility;
}): GraphFilterVisibility | null => {
  if (!wasNoRelationshipsDefault || isNoRelationshipsDefault) {
    return null;
  }
  if (!sameVisibility(currentVisibility, noRelationshipsVisibility)) {
    return null;
  }
  return { ...defaultVisibility };
};
