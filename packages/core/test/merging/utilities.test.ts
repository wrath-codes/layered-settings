import { describe, expect, test } from "bun:test";
import { deepEqual, diffObjects } from "../../src/merging/merger";

describe("deepEqual", () => {
	describe("Primitives", () => {
		test("same numbers are equal", () => {
			expect(deepEqual(42, 42)).toBe(true);
			expect(deepEqual(0, 0)).toBe(true);
			expect(deepEqual(-1, -1)).toBe(true);
		});

		test("same strings are equal", () => {
			expect(deepEqual("hello", "hello")).toBe(true);
			expect(deepEqual("", "")).toBe(true);
		});

		test("same booleans are equal", () => {
			expect(deepEqual(true, true)).toBe(true);
			expect(deepEqual(false, false)).toBe(true);
		});

		test("different primitives are not equal", () => {
			expect(deepEqual(1, 2)).toBe(false);
			expect(deepEqual("a", "b")).toBe(false);
			expect(deepEqual(true, false)).toBe(false);
		});

		test("type differences are not equal", () => {
			expect(deepEqual(1, "1")).toBe(false);
			expect(deepEqual(0, false)).toBe(false);
			expect(deepEqual("", false)).toBe(false);
		});
	});

	describe("Null / Undefined", () => {
		test("null === null", () => {
			expect(deepEqual(null, null)).toBe(true);
		});

		test("undefined === undefined", () => {
			expect(deepEqual(undefined, undefined)).toBe(true);
		});

		test("null !== undefined", () => {
			expect(deepEqual(null, undefined)).toBe(false);
		});

		test("null !== {}", () => {
			expect(deepEqual(null, {})).toBe(false);
		});
	});

	describe("Objects", () => {
		test("empty objects are equal", () => {
			expect(deepEqual({}, {})).toBe(true);
		});

		test("same key/value pairs are equal", () => {
			expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
		});

		test("key order doesn't matter", () => {
			expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
		});

		test("different values are not equal", () => {
			expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
		});

		test("extra keys make objects not equal", () => {
			expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
			expect(deepEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);
		});

		test("nested objects compared recursively", () => {
			expect(deepEqual({ a: { b: { c: 1 } } }, { a: { b: { c: 1 } } })).toBe(true);
			expect(deepEqual({ a: { b: { c: 1 } } }, { a: { b: { c: 2 } } })).toBe(false);
		});
	});

	describe("Arrays", () => {
		test("empty arrays are equal", () => {
			expect(deepEqual([], [])).toBe(true);
		});

		test("same elements in same order are equal", () => {
			expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
			expect(deepEqual(["a", "b"], ["a", "b"])).toBe(true);
		});

		test("different order makes arrays not equal", () => {
			expect(deepEqual([1, 2, 3], [3, 2, 1])).toBe(false);
		});

		test("different length makes arrays not equal", () => {
			expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
			expect(deepEqual([1, 2, 3], [1, 2])).toBe(false);
		});

		test("array vs object with indexed keys are equal (documents current behavior)", () => {
			expect(deepEqual([1, 2], { 0: 1, 1: 2 })).toBe(true);
		});
	});

	describe("Edge Cases", () => {
		test("NaN !== NaN (documents current behavior)", () => {
			expect(deepEqual(Number.NaN, Number.NaN)).toBe(false);
		});

		test("nested arrays of objects", () => {
			const a = [{ x: 1 }, { y: [2, 3] }];
			const b = [{ x: 1 }, { y: [2, 3] }];
			const c = [{ x: 1 }, { y: [2, 4] }];
			expect(deepEqual(a, b)).toBe(true);
			expect(deepEqual(a, c)).toBe(false);
		});
	});
});

describe("diffObjects", () => {
	describe("Basic Operations", () => {
		test("no diff (identical objects) returns empty added/changed/removed", () => {
			const diff = diffObjects({ a: 1, b: 2 }, { a: 1, b: 2 });
			expect(diff.added).toEqual({});
			expect(diff.changed).toEqual({});
			expect(diff.removed).toEqual([]);
		});

		test("added key appears in added", () => {
			const diff = diffObjects({ a: 1 }, { a: 1, b: 2 });
			expect(diff.added).toEqual({ b: 2 });
			expect(diff.changed).toEqual({});
			expect(diff.removed).toEqual([]);
		});

		test("changed value appears in changed", () => {
			const diff = diffObjects({ a: 1 }, { a: 2 });
			expect(diff.added).toEqual({});
			expect(diff.changed).toEqual({ a: 2 });
			expect(diff.removed).toEqual([]);
		});

		test("removed key appears in removed", () => {
			const diff = diffObjects({ a: 1, b: 2 }, { a: 1 });
			expect(diff.added).toEqual({});
			expect(diff.changed).toEqual({});
			expect(diff.removed).toEqual(["b"]);
		});

		test("combined add + change + remove in one diff", () => {
			const diff = diffObjects({ a: 1, b: 2 }, { a: 99, c: 3 });
			expect(diff.added).toEqual({ c: 3 });
			expect(diff.changed).toEqual({ a: 99 });
			expect(diff.removed).toEqual(["b"]);
		});
	});

	describe("Nested Values", () => {
		test("nested equal objects not marked as changed", () => {
			const diff = diffObjects({ a: { b: 1 } }, { a: { b: 1 } });
			expect(diff.added).toEqual({});
			expect(diff.changed).toEqual({});
			expect(diff.removed).toEqual([]);
		});

		test("nested changed objects marked as changed", () => {
			const diff = diffObjects({ a: { b: 1 } }, { a: { b: 2 } });
			expect(diff.changed).toEqual({ a: { b: 2 } });
		});
	});

	describe("Arrays", () => {
		test("same array not marked as changed", () => {
			const diff = diffObjects({ arr: [1, 2, 3] }, { arr: [1, 2, 3] });
			expect(diff.changed).toEqual({});
		});

		test("different order marked as changed", () => {
			const diff = diffObjects({ arr: [1, 2, 3] }, { arr: [3, 2, 1] });
			expect(diff.changed).toEqual({ arr: [3, 2, 1] });
		});

		test("different length marked as changed", () => {
			const diff = diffObjects({ arr: [1, 2] }, { arr: [1, 2, 3] });
			expect(diff.changed).toEqual({ arr: [1, 2, 3] });
		});
	});

	describe("Deletion Scenario (Regression Test)", () => {
		test("removed setting key appears in removed array", () => {
			const oldObj = { theme: "dark", fontSize: 14, language: "en" };
			const newObj = { theme: "dark", language: "en" };
			const diff = diffObjects(oldObj, newObj);
			expect(diff.removed).toContain("fontSize");
		});

		test("only the removed key is in removed, not other keys", () => {
			const oldObj = { theme: "dark", fontSize: 14, language: "en" };
			const newObj = { theme: "dark", language: "en" };
			const diff = diffObjects(oldObj, newObj);
			expect(diff.removed).toEqual(["fontSize"]);
			expect(diff.removed).not.toContain("theme");
			expect(diff.removed).not.toContain("language");
		});
	});

	describe("Undefined Handling", () => {
		test("{ a: undefined } vs {} - key is removed", () => {
			const diff = diffObjects({ a: undefined }, {});
			expect(diff.removed).toEqual(["a"]);
		});

		test("{} vs { a: undefined } - key is added", () => {
			const diff = diffObjects({}, { a: undefined });
			expect(diff.added).toEqual({ a: undefined });
		});

		test("{ a: undefined } vs { a: undefined } - no diff", () => {
			const diff = diffObjects({ a: undefined }, { a: undefined });
			expect(diff.added).toEqual({});
			expect(diff.changed).toEqual({});
			expect(diff.removed).toEqual([]);
		});
	});
});
