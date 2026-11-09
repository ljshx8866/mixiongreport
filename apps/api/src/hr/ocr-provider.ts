/**
 * Vendor-neutral OCR boundary for a future HR document intake flow.
 * No provider, upload endpoint, or sensitive-file persistence is enabled here.
 */
export type OcrDocumentInput = {
  documentType: string;
  mimeType: string;
  content: Uint8Array;
};

export type OcrField = {
  value: string;
  confidence: number | null;
};

export type OcrRecognition = {
  provider: string;
  providerResultId: string | null;
  fields: Record<string, OcrField>;
};

export interface OcrProvider {
  recognize(input: OcrDocumentInput): Promise<OcrRecognition>;
}
