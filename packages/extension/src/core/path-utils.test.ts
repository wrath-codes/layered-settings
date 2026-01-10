import { describe, test, expect } from "bun:test";
import * as path from "node:path";

// Test the isParentOwned logic without requiring SettingsProvider instance
function isParentOwned(sourceFile: string, workspacePath: string): boolean {
  const relative = path.relative(workspacePath, sourceFile);
  return relative.startsWith("..") || path.isAbsolute(relative);
}

describe("isParentOwned", () => {
  const workspacePath = "/home/user/project";

  describe("files under workspace", () => {
    test("file directly in workspace returns false", () => {
      const sourceFile = "/home/user/project/config.json";
      expect(isParentOwned(sourceFile, workspacePath)).toBe(false);
    });

    test("file in .vscode subdirectory returns false", () => {
      const sourceFile = "/home/user/project/.vscode/layered-settings/settings/config.json";
      expect(isParentOwned(sourceFile, workspacePath)).toBe(false);
    });

    test("file in nested subdirectory returns false", () => {
      const sourceFile = "/home/user/project/src/configs/base.json";
      expect(isParentOwned(sourceFile, workspacePath)).toBe(false);
    });
  });

  describe("files in parent directories", () => {
    test("file in immediate parent returns true", () => {
      const sourceFile = "/home/user/config.json";
      expect(isParentOwned(sourceFile, workspacePath)).toBe(true);
    });

    test("file in grandparent returns true", () => {
      const sourceFile = "/home/config.json";
      expect(isParentOwned(sourceFile, workspacePath)).toBe(true);
    });

    test("file in sibling directory returns true", () => {
      const sourceFile = "/home/user/other-project/config.json";
      expect(isParentOwned(sourceFile, workspacePath)).toBe(true);
    });

    test("root-level config file returns true", () => {
      const sourceFile = "/config.json";
      expect(isParentOwned(sourceFile, workspacePath)).toBe(true);
    });
  });

  describe("monorepo scenarios", () => {
    test("parent monorepo config is parent-owned", () => {
      const monorepoWorkspace = "/home/user/monorepo/packages/app";
      const rootConfig = "/home/user/monorepo/.vscode/layered-settings/settings/config.json";
      expect(isParentOwned(rootConfig, monorepoWorkspace)).toBe(true);
    });

    test("sibling package config is parent-owned", () => {
      const monorepoWorkspace = "/home/user/monorepo/packages/app";
      const siblingConfig = "/home/user/monorepo/packages/lib/.vscode/layered-settings/settings/config.json";
      expect(isParentOwned(siblingConfig, monorepoWorkspace)).toBe(true);
    });

    test("child package config within workspace is not parent-owned", () => {
      const monorepoRoot = "/home/user/monorepo";
      const childConfig = "/home/user/monorepo/packages/app/.vscode/layered-settings/settings/config.json";
      expect(isParentOwned(childConfig, monorepoRoot)).toBe(false);
    });
  });

  describe("edge cases", () => {
    test("same path returns false", () => {
      const sourceFile = "/home/user/project";
      expect(isParentOwned(sourceFile, workspacePath)).toBe(false);
    });

    test("workspace with trailing slash handles correctly", () => {
      const sourceFile = "/home/user/project/config.json";
      // path.relative handles trailing slashes
      expect(isParentOwned(sourceFile, "/home/user/project/")).toBe(false);
    });
  });
});

describe("findSegmentForIndex", () => {
  type ArraySegmentProvenance = {
    sourceFile: string;
    start: number;
    length: number;
  };

  function findSegmentForIndex(
    segments: ArraySegmentProvenance[],
    index: number
  ): ArraySegmentProvenance | null {
    return (
      segments.find(
        (seg) => index >= seg.start && index < seg.start + seg.length
      ) ?? null
    );
  }

  test("finds segment for index at start", () => {
    const segments: ArraySegmentProvenance[] = [
      { sourceFile: "/a.json", start: 0, length: 3 },
      { sourceFile: "/b.json", start: 3, length: 2 },
    ];
    expect(findSegmentForIndex(segments, 0)?.sourceFile).toBe("/a.json");
  });

  test("finds segment for index in middle", () => {
    const segments: ArraySegmentProvenance[] = [
      { sourceFile: "/a.json", start: 0, length: 3 },
      { sourceFile: "/b.json", start: 3, length: 2 },
    ];
    expect(findSegmentForIndex(segments, 1)?.sourceFile).toBe("/a.json");
    expect(findSegmentForIndex(segments, 4)?.sourceFile).toBe("/b.json");
  });

  test("finds segment for last index in segment", () => {
    const segments: ArraySegmentProvenance[] = [
      { sourceFile: "/a.json", start: 0, length: 3 },
      { sourceFile: "/b.json", start: 3, length: 2 },
    ];
    expect(findSegmentForIndex(segments, 2)?.sourceFile).toBe("/a.json");
  });

  test("returns null for index beyond all segments", () => {
    const segments: ArraySegmentProvenance[] = [
      { sourceFile: "/a.json", start: 0, length: 3 },
    ];
    expect(findSegmentForIndex(segments, 5)).toBe(null);
  });

  test("returns null for empty segments", () => {
    expect(findSegmentForIndex([], 0)).toBe(null);
  });

  test("handles empty segment (length 0)", () => {
    const segments: ArraySegmentProvenance[] = [
      { sourceFile: "/a.json", start: 0, length: 0 },
      { sourceFile: "/b.json", start: 0, length: 2 },
    ];
    // Index 0 should match the second segment (first has length 0)
    expect(findSegmentForIndex(segments, 0)?.sourceFile).toBe("/b.json");
  });
});
