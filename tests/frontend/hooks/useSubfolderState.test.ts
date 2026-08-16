import { describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useSubfolderState } from "@/hooks/useSubfolderState";
import { preloadMocks } from "../helpers/preload-mocks";

const VISIBILITY_KEY = "konomi-subfolder-visibility";
const CASE_REPAIR_KEY = "konomi-subfolder-visibility-case-repaired";

describe("useSubfolderState visibility overrides", () => {
  it("re-spells overrides stored under a folded path onto the reported one", async () => {
    // What an older build persisted: `getSubfolderPaths` lower-cased its result
    // on win32, so the hidden subfolder was recorded under a spelling the
    // backend no longer reports. Left alone, the override stops matching and
    // every hidden subfolder reappears on upgrade.
    localStorage.setItem(
      VISIBILITY_KEY,
      JSON.stringify({ "1": ["c:/library/alpha", "__root__"] }),
    );
    preloadMocks.folder.listSubdirectories.mockResolvedValue([
      { path: "C:\\Library\\Alpha", depth: 1 },
      { path: "C:\\Library\\Beta", depth: 1 },
    ]);

    const { result } = renderHook(() => useSubfolderState());

    await act(async () => {
      await result.current.refreshSubfolders([1]);
    });

    await waitFor(() => {
      expect(result.current.isSubfolderVisible("C:\\Library\\Alpha", 1)).toBe(
        false,
      );
    });
    // Beta was never hidden and must not be dragged along by the repair.
    expect(result.current.isSubfolderVisible("C:\\Library\\Beta", 1)).toBe(true);
    // The root sentinel is not a path and survives untouched.
    expect(result.current.isRootVisible(1)).toBe(false);
    expect(JSON.parse(localStorage.getItem(VISIBILITY_KEY) ?? "{}")).toEqual({
      "1": ["C:\\Library\\Alpha", "__root__"],
    });
  });

  it("leaves an override alone when two reported paths differ only by case", async () => {
    // On a case-sensitive backend these are two distinct directories, so there
    // is no single right answer and guessing one would hide the wrong folder.
    localStorage.setItem(
      VISIBILITY_KEY,
      JSON.stringify({ "1": ["/library/alpha"] }),
    );
    preloadMocks.folder.listSubdirectories.mockResolvedValue([
      { path: "/library/Alpha", depth: 1 },
      { path: "/library/ALPHA", depth: 1 },
    ]);

    const { result } = renderHook(() => useSubfolderState());

    await act(async () => {
      await result.current.refreshSubfolders([1]);
    });

    expect(result.current.isSubfolderVisible("/library/Alpha", 1)).toBe(true);
    expect(result.current.isSubfolderVisible("/library/ALPHA", 1)).toBe(true);
    expect(JSON.parse(localStorage.getItem(VISIBILITY_KEY) ?? "{}")).toEqual({
      "1": ["/library/alpha"],
    });
  });

  it("does not re-point an override that already carries on-disk casing", async () => {
    // Not the old format — this entry was stored under the spelling the backend
    // reports. On a case-sensitive backend `Sketch` is a different directory,
    // and repairing case here would move the override onto it the moment
    // `sketch` drops out of a partial list.
    localStorage.setItem(
      VISIBILITY_KEY,
      JSON.stringify({ "1": ["/library/Sketch"] }),
    );
    preloadMocks.folder.listSubdirectories.mockResolvedValue([
      { path: "/library/sketch", depth: 1 },
    ]);

    const { result } = renderHook(() => useSubfolderState());

    await act(async () => {
      await result.current.refreshSubfolders([1]);
    });

    expect(result.current.isSubfolderVisible("/library/sketch", 1)).toBe(true);
    expect(JSON.parse(localStorage.getItem(VISIBILITY_KEY) ?? "{}")).toEqual({
      "1": ["/library/Sketch"],
    });
  });

  it("repairs a separator-only mismatch whatever the casing", async () => {
    // Separators are not case: `subfolderKey` already calls these the same
    // path, so re-spelling can never land on a different subfolder.
    localStorage.setItem(
      VISIBILITY_KEY,
      JSON.stringify({ "1": ["C:/Library/Alpha/"] }),
    );
    preloadMocks.folder.listSubdirectories.mockResolvedValue([
      { path: "C:\\Library\\Alpha", depth: 1 },
    ]);

    const { result } = renderHook(() => useSubfolderState());

    await act(async () => {
      await result.current.refreshSubfolders([1]);
    });

    await waitFor(() => {
      expect(result.current.isSubfolderVisible("C:\\Library\\Alpha", 1)).toBe(
        false,
      );
    });
    expect(JSON.parse(localStorage.getItem(VISIBILITY_KEY) ?? "{}")).toEqual({
      "1": ["C:\\Library\\Alpha"],
    });
  });

  it("stops repairing case once the folder has had its one pass", async () => {
    // The damaging case: on a Linux backend `/library/sketch` is a real
    // directory whose override is legitimately all-lower-case, and `Sketch` is
    // a distinct sibling. If the case repair stayed armed, the first refresh
    // that reports a partial list without `sketch` would move the override onto
    // `Sketch` and hide a folder the user never chose.
    localStorage.setItem(
      VISIBILITY_KEY,
      JSON.stringify({ "1": ["/library/sketch"] }),
    );
    preloadMocks.folder.listSubdirectories.mockResolvedValue([
      { path: "/library/sketch", depth: 1 },
      { path: "/library/Sketch", depth: 1 },
    ]);

    const { result } = renderHook(() => useSubfolderState());

    // First pass: the exact spelling is present, so nothing is rewritten — but
    // the folder is stamped as having seen the backend's spelling.
    await act(async () => {
      await result.current.refreshSubfolders([1]);
    });
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(CASE_REPAIR_KEY) ?? "[]")).toEqual(
        [1],
      );
    });

    // `sketch` drops out mid-scan. Without the stamp the folded match would now
    // be unambiguous and re-point the override.
    preloadMocks.folder.listSubdirectories.mockResolvedValue([
      { path: "/library/Sketch", depth: 1 },
    ]);
    await act(async () => {
      await result.current.refreshSubfolders([1]);
    });

    expect(result.current.isSubfolderVisible("/library/Sketch", 1)).toBe(true);
    expect(JSON.parse(localStorage.getItem(VISIBILITY_KEY) ?? "{}")).toEqual({
      "1": ["/library/sketch"],
    });
  });

  it("keeps an unrecognised override so a partial list cannot drop it", async () => {
    // `refreshSubfolders` runs mid-scan too, when the subfolder list is still
    // filling in. An entry matching nothing yet is a real override, not a
    // stale one.
    localStorage.setItem(
      VISIBILITY_KEY,
      JSON.stringify({ "1": ["/library/gamma"] }),
    );
    preloadMocks.folder.listSubdirectories.mockResolvedValue([
      { path: "/library/alpha", depth: 1 },
    ]);

    const { result } = renderHook(() => useSubfolderState());

    await act(async () => {
      await result.current.refreshSubfolders([1]);
    });

    expect(JSON.parse(localStorage.getItem(VISIBILITY_KEY) ?? "{}")).toEqual({
      "1": ["/library/gamma"],
    });
  });
});
