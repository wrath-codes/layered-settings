import { deepEqual } from "./merger";

export type ArrayDiff = {
  kind: "none" | "simple" | "complex";
  added: unknown[];
  removed: unknown[];
  removedIndices: number[]; // Indices in original (prev) array
};

const MAX_ARRAY_SIZE = 1000;

function computeLCSMatrix(
  a: unknown[],
  b: unknown[],
  eq: (x: unknown, y: unknown) => boolean
): number[][] {
  const m = a.length;
  const n = b.length;

  // Create (m+1) x (n+1) matrix initialized with zeros
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array.from({ length: n + 1 }, () => 0)
  );

  // Fill matrix row by row (must be sequential due to dependencies)
  Array.from({ length: m }, (_, idx) => idx + 1).forEach((i) => {
    const row = dp[i];
    const prevRow = dp[i - 1];
    if (!row || !prevRow) return;

    Array.from({ length: n }, (_, idx) => idx + 1).forEach((j) => {
      if (eq(a[i - 1], b[j - 1])) {
        row[j] = (prevRow[j - 1] ?? 0) + 1;
      } else {
        row[j] = Math.max(prevRow[j] ?? 0, row[j - 1] ?? 0);
      }
    });
  });

  return dp;
}

function isMultisetEqual(
  a: unknown[],
  b: unknown[],
  eq: (x: unknown, y: unknown) => boolean
): boolean {
  if (a.length !== b.length) return false;

  const bUsed = Array.from({ length: b.length }, () => false);

  return a.every((aItem) => {
    const matchIndex = b.findIndex(
      (bItem, j) => !bUsed[j] && eq(aItem, bItem)
    );
    if (matchIndex === -1) return false;
    bUsed[matchIndex] = true;
    return true;
  });
}

type BacktrackState = {
  i: number;
  j: number;
  added: unknown[];
  removed: unknown[];
  removedIndices: number[];
};

function backtrackStep(
  state: BacktrackState,
  prev: unknown[],
  curr: unknown[],
  lcsMatrix: number[][],
  eq: (x: unknown, y: unknown) => boolean
): BacktrackState {
  const { i, j, added, removed, removedIndices } = state;

  if (i <= 0 && j <= 0) return state;

  if (i > 0 && j > 0 && eq(prev[i - 1], curr[j - 1])) {
    return { i: i - 1, j: j - 1, added, removed, removedIndices };
  }

  if (
    j > 0 &&
    (i === 0 || (lcsMatrix[i]?.[j - 1] ?? 0) >= (lcsMatrix[i - 1]?.[j] ?? 0))
  ) {
    return {
      i,
      j: j - 1,
      added: [...added, curr[j - 1]],
      removed,
      removedIndices,
    };
  }

  if (i > 0) {
    return {
      i: i - 1,
      j,
      added,
      removed: [...removed, prev[i - 1]],
      removedIndices: [...removedIndices, i - 1],
    };
  }

  return state;
}

function backtrackDiff(
  prev: unknown[],
  curr: unknown[],
  lcsMatrix: number[][],
  eq: (x: unknown, y: unknown) => boolean
): { added: unknown[]; removed: unknown[]; removedIndices: number[] } {
  let state: BacktrackState = {
    i: prev.length,
    j: curr.length,
    added: [],
    removed: [],
    removedIndices: [],
  };

  while (state.i > 0 || state.j > 0) {
    state = backtrackStep(state, prev, curr, lcsMatrix, eq);
  }

  return {
    added: [...state.added].reverse(),
    removed: [...state.removed].reverse(),
    removedIndices: [...state.removedIndices].reverse(),
  };
}

export function diffArrays(prev: unknown[], curr: unknown[]): ArrayDiff {
  const emptyDiff: ArrayDiff = {
    kind: "none",
    added: [],
    removed: [],
    removedIndices: [],
  };

  // Early exit: identical arrays
  if (
    prev.length === curr.length &&
    prev.every((v, i) => deepEqual(v, curr[i]))
  ) {
    return emptyDiff;
  }

  // Performance guard
  if (prev.length > MAX_ARRAY_SIZE || curr.length > MAX_ARRAY_SIZE) {
    return { ...emptyDiff, kind: "complex" };
  }

  // Check if multiset-identical (same elements, different order)
  if (isMultisetEqual(prev, curr, deepEqual)) {
    return emptyDiff;
  }

  // Compute LCS and derive diff
  const lcsMatrix = computeLCSMatrix(prev, curr, deepEqual);
  const { added, removed, removedIndices } = backtrackDiff(
    prev,
    curr,
    lcsMatrix,
    deepEqual
  );

  return { kind: "simple", added, removed, removedIndices };
}
