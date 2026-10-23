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
    "This record could not be loaded. The failed request does not establish whether it exists. Nothing on this page can be trusted until it loads.",
  page: "This page's data could not be fully loaded because a request failed. Data affected by the failed request cannot be trusted until it loads.",
};

export function dataLoadErrorDescription(kind: DataLoadErrorKind): string {
  return DESCRIPTIONS[kind];
}

/**
 * Wording for a chart whose data failed to load (regression for #219). The
 * kind-keyed defaults are about lists, records and pages; none fits a chart,
 * whose failure mode reads visually as "no data plotted" — i.e. no usage. A
 * failed fetch establishes neither usage nor its absence.
 */
export const CHART_DATA_LOAD_ERROR_DESCRIPTION =
  "This chart is blank because the request failed. Whether there was any usage cannot be told until it loads.";
