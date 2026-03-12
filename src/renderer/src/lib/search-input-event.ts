export const SEARCH_INPUT_APPEND_TAG_EVENT = "konomi:search-input-append-tag";

export type SearchInputAppendTagDetail = {
  tag: string;
  focusInput?: boolean;
  suppressAutocomplete?: boolean;
};

export function dispatchSearchInputAppendTag(
  detail: SearchInputAppendTagDetail,
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<SearchInputAppendTagDetail>(SEARCH_INPUT_APPEND_TAG_EVENT, {
      detail,
    }),
  );
}
