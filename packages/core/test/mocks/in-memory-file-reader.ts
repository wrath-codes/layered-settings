import type { FileReader } from "../../src/merging/merger";

export class InMemoryFileReader implements FileReader {
  private files = new Map<string, string>();

  addFile(path: string, content: string): void {
    this.files.set(this.normalizePath(path), content);
  }

  addJsonFile(path: string, content: object): void {
    this.addFile(path, JSON.stringify(content));
  }

  removeFile(path: string): void {
    this.files.delete(this.normalizePath(path));
  }

  clear(): void {
    this.files.clear();
  }

  readFile(path: string): string | null {
    return this.files.get(this.normalizePath(path)) ?? null;
  }

  exists(path: string): boolean {
    return this.files.has(this.normalizePath(path));
  }

  resolvePath(base: string, relative: string): string {
    if (this.isAbsolute(relative)) {
      return this.normalizePath(relative);
    }

    const baseParts = base.split("/").filter(Boolean);
    const relativeParts = relative.split("/").filter(Boolean);

    for (const part of relativeParts) {
      if (part === "..") {
        baseParts.pop();
      } else if (part !== ".") {
        baseParts.push(part);
      }
    }

    return "/" + baseParts.join("/");
  }

  dirname(path: string): string {
    const normalized = this.normalizePath(path);
    const lastSlash = normalized.lastIndexOf("/");
    if (lastSlash <= 0) return "/";
    return normalized.substring(0, lastSlash);
  }

  basename(path: string): string {
    const normalized = this.normalizePath(path);
    const lastSlash = normalized.lastIndexOf("/");
    return normalized.substring(lastSlash + 1);
  }

  isAbsolute(path: string): boolean {
    return path.startsWith("/");
  }

  private normalizePath(path: string): string {
    return path.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
  }
}
