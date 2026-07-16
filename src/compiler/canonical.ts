import {
  DesignDocumentV1Schema,
  SheetPartSchema,
  type DesignDocumentV1,
  type SheetPart
} from "../domain/contracts.js";
import { hashCanonical } from "../domain/hash.js";

export function parseDesignDocument(value: unknown): DesignDocumentV1 {
  return DesignDocumentV1Schema.parse(value);
}

export async function canonicalPartHash(part: SheetPart): Promise<string> {
  return hashCanonical(SheetPartSchema.parse(part));
}

export async function canonicalDocumentHash(document: DesignDocumentV1): Promise<string> {
  return hashCanonical(parseDesignDocument(document));
}
