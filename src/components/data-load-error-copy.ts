/**
 * Default `description` copy for `DataLoadError`, keyed by the kind of surface
 * that failed to load. Lives outside the component so it is testable without a
 * DOM: "this list is empty" is a claim about a list, and a single-record or
 * whole-page surface must not make it.
 */
export type DataLoadErrorKind = "list" | "record" | "page";

const DESCRIPTIONS: Record<DataLoadErrorKind, string> = {
  list: "This list is empty because the request failed, not because there is nothing to show. Nothing below this message can be trusted until it loads.",
  record:
    "This record could not be loaded, not because it does not exist. Nothing on this page can be trusted until it loads.",
  page: "This page's data could not be loaded, not because there is nothing to show. Nothing shown here can be trusted until it loads.",
};

export function dataLoadErrorDescription(kind: DataLoadErrorKind): string {
  return DESCRIPTIONS[kind];
}
