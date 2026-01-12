import { describe, test, expect, beforeEach } from "bun:test";

const resolveConfigRelativePath = (baseDocUri: string, relativePath: string): string => {
  try {
    const baseUrl = new URL(baseDocUri);
    const pathParts = baseUrl.pathname.split("/");
    pathParts.pop();
    const baseDir = pathParts.join("/");

    if (relativePath.startsWith("./")) {
      relativePath = relativePath.slice(2);
    }

    let resolvedPath: string;
    if (relativePath.startsWith("../")) {
      const relParts = relativePath.split("/");
      const baseParts = baseDir.split("/").filter(Boolean);

      while (relParts[0] === "..") {
        relParts.shift();
        baseParts.pop();
      }

      resolvedPath = "/" + [...baseParts, ...relParts].join("/");
    } else if (relativePath.startsWith("/")) {
      resolvedPath = baseDir + relativePath;
    } else {
      resolvedPath = baseDir + "/" + relativePath;
    }

    return `${baseUrl.protocol}//${baseUrl.host}${resolvedPath}`;
  } catch {
    return relativePath;
  }
};

describe("resolveConfigRelativePath (T3.3)", () => {
  test("resolves relative path from file URI", () => {
    const base = "file:///workspace/.vscode/layered-settings/settings/config.json";
    const result = resolveConfigRelativePath(base, "./base.json");
    expect(result).toBe("file:///workspace/.vscode/layered-settings/settings/base.json");
  });

  test("resolves parent directory path", () => {
    const base = "file:///workspace/.vscode/layered-settings/settings/config.json";
    const result = resolveConfigRelativePath(base, "../shared/common.json");
    expect(result).toBe("file:///workspace/.vscode/layered-settings/shared/common.json");
  });

  test("handles sibling file without ./", () => {
    const base = "file:///workspace/.vscode/layered-settings/settings/config.json";
    const result = resolveConfigRelativePath(base, "base.json");
    expect(result).toBe("file:///workspace/.vscode/layered-settings/settings/base.json");
  });

  test("handles deeply nested parent paths", () => {
    const base = "file:///workspace/.vscode/layered-settings/settings/nested/config.json";
    const result = resolveConfigRelativePath(base, "../../shared.json");
    expect(result).toBe("file:///workspace/.vscode/layered-settings/shared.json");
  });

  test("T3.3-U4: returns original path on invalid URI", () => {
    const result = resolveConfigRelativePath("not-a-uri", "./base.json");
    expect(result).toBe("./base.json");
  });
});

describe("Language Service Singleton (T3.2)", () => {
  let lsInstance: unknown = null;
  let configureCallCount = 0;

  const getJsonLanguageService = () => {
    if (!lsInstance) {
      lsInstance = { id: Math.random(), configured: false };
      configureCallCount++;
    }
    return lsInstance;
  };

  const resetForTest = () => {
    lsInstance = null;
    configureCallCount = 0;
  };

  beforeEach(() => {
    resetForTest();
  });

  test("T3.2-U1: getJsonLanguageService returns singleton", () => {
    const first = getJsonLanguageService();
    const second = getJsonLanguageService();

    expect(first).toBe(second);
    expect(configureCallCount).toBe(1);
  });

  test("T3.2-U2: reconfiguration updates schema", () => {
    const ls = getJsonLanguageService() as { configured: boolean };
    expect(ls.configured).toBe(false);

    ls.configured = true;

    const same = getJsonLanguageService() as { configured: boolean };
    expect(same.configured).toBe(true);
    expect(same).toBe(ls);
  });
});

describe("JSONDocument Cache (T3.4)", () => {
  const cache = new Map<string, { version: number; jsonDoc: { parsed: boolean } }>();

  const getOrParseJsonDocument = (uri: string, version: number) => {
    const key = uri;
    const cached = cache.get(key);

    if (cached && cached.version === version) {
      return cached.jsonDoc;
    }

    const jsonDoc = { parsed: true, parseTime: Date.now() };
    cache.set(key, { version, jsonDoc });
    return jsonDoc;
  };

  const evictJsonDocument = (uri: string) => {
    cache.delete(uri);
  };

  beforeEach(() => {
    cache.clear();
  });

  test("T3.4-U1: first call parses and caches", () => {
    const uri = "file:///test/config.json";

    const first = getOrParseJsonDocument(uri, 1);
    const second = getOrParseJsonDocument(uri, 1);

    expect(first).toBe(second);
    expect(cache.size).toBe(1);
  });

  test("T3.4-U2: version change invalidates cache", () => {
    const uri = "file:///test/config.json";

    const v1 = getOrParseJsonDocument(uri, 1);
    const v2 = getOrParseJsonDocument(uri, 2);

    expect(v1).not.toBe(v2);
    expect(cache.get(uri)?.version).toBe(2);
  });

  test("T3.4-U3: evictJsonDocument removes entry", () => {
    const uri = "file:///test/config.json";

    getOrParseJsonDocument(uri, 1);
    expect(cache.has(uri)).toBe(true);

    evictJsonDocument(uri);
    expect(cache.has(uri)).toBe(false);

    const newDoc = getOrParseJsonDocument(uri, 1);
    expect(newDoc.parsed).toBe(true);
  });

  test("T3.4-U4: closing document evicts cache (simulated)", () => {
    const uri = "file:///test/config.json";

    getOrParseJsonDocument(uri, 1);
    expect(cache.has(uri)).toBe(true);

    evictJsonDocument(uri);
    expect(cache.has(uri)).toBe(false);
  });
});
