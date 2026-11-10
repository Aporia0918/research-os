import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { extractPdfText, type GetDocument, type PdfText } from './extract';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
/** Browser / Capacitor WebView entry: runs fully on the phone, nothing is uploaded. */
export function extractOnPhone(data: Uint8Array): Promise<PdfText> {
  return extractPdfText(data, pdfjs.getDocument as unknown as GetDocument);
}
