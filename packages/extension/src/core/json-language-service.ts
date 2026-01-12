import * as vscode from "vscode";
import {
  getLanguageService,
  type LanguageService,
  type JSONDocument,
  TextDocument as LsTextDocument,
  type DocumentLanguageSettings,
  type SchemaConfiguration,
} from "vscode-json-languageservice";
import { buildSettingsSchema } from "./settings-schema";

let languageService: LanguageService | null = null;
const jsonDocumentCache = new Map<string, { version: number; jsonDoc: JSONDocument }>();

export const jsoncDocumentSettings: DocumentLanguageSettings = {
  comments: "ignore",
  trailingCommas: "ignore",
};

export function resolveConfigRelativePath(baseDocUri: string, relativePath: string): string {
  try {
    const baseUri = vscode.Uri.parse(baseDocUri);
    const baseDir = vscode.Uri.joinPath(baseUri, "..");
    const resolved = vscode.Uri.joinPath(baseDir, relativePath);
    return resolved.toString();
  } catch {
    return relativePath;
  }
}

export function getJsonLanguageService(): LanguageService {
  if (!languageService) {
    languageService = getLanguageService({
      workspaceContext: {
        resolveRelativePath: resolveConfigRelativePath,
      },
    });
    configureJsonLanguageService();
  }
  return languageService;
}

export function configureJsonLanguageService(): void {
  if (!languageService) return;

  const schema = buildSettingsSchema();
  const schemaUri = "layered-settings://schema";

  const schemaConfig: SchemaConfiguration = {
    uri: schemaUri,
    fileMatch: ["**/.vscode/layered-settings/**/*.json"],
    schema,
  };

  languageService.configure({
    validate: true,
    schemas: [schemaConfig],
  });
}

export function toLsTextDocument(doc: vscode.TextDocument): LsTextDocument {
  return LsTextDocument.create(
    doc.uri.toString(),
    doc.languageId,
    doc.version,
    doc.getText()
  );
}

export function getOrParseJsonDocument(doc: vscode.TextDocument): JSONDocument {
  const key = doc.uri.toString();
  const cached = jsonDocumentCache.get(key);

  if (cached && cached.version === doc.version) {
    return cached.jsonDoc;
  }

  const ls = getJsonLanguageService();
  const lsDoc = toLsTextDocument(doc);
  const jsonDoc = ls.parseJSONDocument(lsDoc);

  jsonDocumentCache.set(key, { version: doc.version, jsonDoc });
  return jsonDoc;
}

export function evictJsonDocument(uriString: string): void {
  jsonDocumentCache.delete(uriString);
}
