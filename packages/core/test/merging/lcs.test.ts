import { describe, test, expect } from "bun:test";
import { diffArrays } from "../../src/merging/lcs";

describe("diffArrays", () => {
  describe("identical arrays", () => {
    test("empty arrays → kind: none", () => {
      const result = diffArrays([], []);
      expect(result.kind).toBe("none");
      expect(result.added).toEqual([]);
      expect(result.removed).toEqual([]);
      expect(result.removedIndices).toEqual([]);
    });

    test("identical primitive arrays → kind: none", () => {
      const result = diffArrays([1, 2, 3], [1, 2, 3]);
      expect(result.kind).toBe("none");
    });

    test("identical string arrays → kind: none", () => {
      const result = diffArrays(["*.log", "*.tmp"], ["*.log", "*.tmp"]);
      expect(result.kind).toBe("none");
    });

    test("identical object arrays → kind: none", () => {
      const result = diffArrays(
        [{ a: 1 }, { b: 2 }],
        [{ a: 1 }, { b: 2 }]
      );
      expect(result.kind).toBe("none");
    });
  });

  describe("reorder only (multiset identical)", () => {
    test("simple reorder → kind: none", () => {
      const result = diffArrays([1, 2, 3], [3, 1, 2]);
      expect(result.kind).toBe("none");
    });

    test("object reorder → kind: none", () => {
      const result = diffArrays(
        [{ x: 1 }, { y: 2 }],
        [{ y: 2 }, { x: 1 }]
      );
      expect(result.kind).toBe("none");
    });

    test("reorder with duplicates → kind: none", () => {
      const result = diffArrays([1, 2, 2, 3], [2, 1, 3, 2]);
      expect(result.kind).toBe("none");
    });
  });

  describe("additions", () => {
    test("single addition at end", () => {
      const result = diffArrays([1, 2], [1, 2, 3]);
      expect(result.kind).toBe("simple");
      expect(result.added).toEqual([3]);
      expect(result.removed).toEqual([]);
      expect(result.removedIndices).toEqual([]);
    });

    test("single addition at start", () => {
      const result = diffArrays([2, 3], [1, 2, 3]);
      expect(result.kind).toBe("simple");
      expect(result.added).toEqual([1]);
      expect(result.removed).toEqual([]);
    });

    test("multiple additions", () => {
      const result = diffArrays([1, 3], [1, 2, 3, 4]);
      expect(result.kind).toBe("simple");
      expect(result.added).toEqual([2, 4]);
      expect(result.removed).toEqual([]);
    });

    test("addition from empty", () => {
      const result = diffArrays([], [1, 2, 3]);
      expect(result.kind).toBe("simple");
      expect(result.added).toEqual([1, 2, 3]);
    });
  });

  describe("removals", () => {
    test("single removal from end", () => {
      const result = diffArrays([1, 2, 3], [1, 2]);
      expect(result.kind).toBe("simple");
      expect(result.added).toEqual([]);
      expect(result.removed).toEqual([3]);
      expect(result.removedIndices).toEqual([2]);
    });

    test("single removal from start", () => {
      const result = diffArrays([1, 2, 3], [2, 3]);
      expect(result.kind).toBe("simple");
      expect(result.removed).toEqual([1]);
      expect(result.removedIndices).toEqual([0]);
    });

    test("single removal from middle", () => {
      const result = diffArrays([1, 2, 3], [1, 3]);
      expect(result.kind).toBe("simple");
      expect(result.removed).toEqual([2]);
      expect(result.removedIndices).toEqual([1]);
    });

    test("multiple removals", () => {
      const result = diffArrays([1, 2, 3, 4], [1, 4]);
      expect(result.kind).toBe("simple");
      expect(result.removed).toEqual([2, 3]);
      expect(result.removedIndices).toEqual([1, 2]);
    });

    test("removal to empty", () => {
      const result = diffArrays([1, 2, 3], []);
      expect(result.kind).toBe("simple");
      expect(result.removed).toEqual([1, 2, 3]);
      expect(result.removedIndices).toEqual([0, 1, 2]);
    });
  });

  describe("mixed add/remove", () => {
    test("add one, remove one", () => {
      const result = diffArrays([1, 2, 3], [1, 4, 3]);
      expect(result.kind).toBe("simple");
      expect(result.added).toEqual([4]);
      expect(result.removed).toEqual([2]);
      expect(result.removedIndices).toEqual([1]);
    });

    test("replace all", () => {
      const result = diffArrays([1, 2], [3, 4]);
      expect(result.kind).toBe("simple");
      expect(result.added).toEqual([3, 4]);
      expect(result.removed).toEqual([1, 2]);
      expect(result.removedIndices).toEqual([0, 1]);
    });

    test("complex mixed changes", () => {
      const result = diffArrays([1, 2, 3, 4, 5], [1, 3, 6, 5]);
      expect(result.kind).toBe("simple");
      expect(result.added).toEqual([6]);
      expect(result.removed).toEqual([2, 4]);
      expect(result.removedIndices).toEqual([1, 3]);
    });
  });

  describe("duplicates", () => {
    test("add duplicate element", () => {
      const result = diffArrays([1, 2], [1, 2, 2]);
      expect(result.kind).toBe("simple");
      expect(result.added).toEqual([2]);
    });

    test("remove one of duplicates", () => {
      const result = diffArrays([1, 2, 2], [1, 2]);
      expect(result.kind).toBe("simple");
      expect(result.removed).toEqual([2]);
      // Should report the index of one of the 2s
      expect(result.removedIndices.length).toBe(1);
    });

    test("multiple same elements - remove some", () => {
      const result = diffArrays([1, 1, 1, 1], [1, 1]);
      expect(result.kind).toBe("simple");
      expect(result.removed).toEqual([1, 1]);
      expect(result.removedIndices.length).toBe(2);
    });
  });

  describe("object arrays", () => {
    test("add object", () => {
      const result = diffArrays(
        [{ id: 1 }],
        [{ id: 1 }, { id: 2 }]
      );
      expect(result.kind).toBe("simple");
      expect(result.added).toEqual([{ id: 2 }]);
    });

    test("remove object", () => {
      const result = diffArrays(
        [{ id: 1 }, { id: 2 }],
        [{ id: 1 }]
      );
      expect(result.kind).toBe("simple");
      expect(result.removed).toEqual([{ id: 2 }]);
      expect(result.removedIndices).toEqual([1]);
    });

    test("modify object (treated as remove old + add new)", () => {
      const result = diffArrays(
        [{ id: 1, name: "old" }],
        [{ id: 1, name: "new" }]
      );
      expect(result.kind).toBe("simple");
      expect(result.removed).toEqual([{ id: 1, name: "old" }]);
      expect(result.added).toEqual([{ id: 1, name: "new" }]);
    });
  });

  describe("performance guard", () => {
    test("array over 1000 elements → kind: complex", () => {
      const largeArray = Array.from({ length: 1001 }, (_, i) => i);
      const result = diffArrays(largeArray, [...largeArray, 9999]);
      expect(result.kind).toBe("complex");
      expect(result.added).toEqual([]);
      expect(result.removed).toEqual([]);
    });

    test("exactly 1000 elements → still processes", () => {
      const array = Array.from({ length: 1000 }, (_, i) => i);
      const result = diffArrays(array, [...array, 9999]);
      // 1001 elements > 1000 limit, so this is complex
      expect(result.kind).toBe("complex");
    });

    test("under 1000 elements → processes normally", () => {
      const array = Array.from({ length: 999 }, (_, i) => i);
      const result = diffArrays(array, [...array, 9999]);
      expect(result.kind).toBe("simple");
      expect(result.added).toEqual([9999]);
    });
  });

  describe("edge cases", () => {
    test("single element arrays - same", () => {
      const result = diffArrays([1], [1]);
      expect(result.kind).toBe("none");
    });

    test("single element arrays - different", () => {
      const result = diffArrays([1], [2]);
      expect(result.kind).toBe("simple");
      expect(result.added).toEqual([2]);
      expect(result.removed).toEqual([1]);
    });

    test("mixed types in array", () => {
      const result = diffArrays(
        [1, "two", { three: 3 }],
        [1, "two", { three: 3 }, null]
      );
      expect(result.kind).toBe("simple");
      expect(result.added).toEqual([null]);
    });

    test("null and undefined handling", () => {
      const result = diffArrays([null, undefined], [null, undefined]);
      expect(result.kind).toBe("none");
    });
  });
});
