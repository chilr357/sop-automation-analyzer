const fs = require('node:fs/promises');

/**
 * Extract per-page text from a text-based PDF.
 * Uses pdfjs-dist (loaded via dynamic import because it is ESM).
 *
 * @param {string} filePath
 * @returns {Promise<Array<{pageNumber: number, text: string}>>}
 */
async function extractPdfPagesText(filePath, { onProgress } = {}) {
  const data = await fs.readFile(filePath);
  // pdfjs expects Uint8Array for binary input (Node's Buffer can break on some platforms/runtimes).
  const uint8 = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

  // pdfjs-dist ships ESM. Use the legacy build which supports Node-style usage.
  // Path reference: pdfjs-dist/legacy/build/pdf.mjs
  // eslint-disable-next-line no-unused-vars
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

  // In Electron/Node contexts, disabling the worker avoids workerSrc resolution issues.
  const loadingTask = pdfjs.getDocument({ data: uint8, disableWorker: true });
  const pdf = await loadingTask.promise;

  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = (content.items || [])
      .map((item) => (typeof item.str === 'string' ? item.str : ''))
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    pages.push({ pageNumber, text });
    if (onProgress) {
      try {
        onProgress({ stage: 'extracting', pageNumber, totalPages: pdf.numPages });
      } catch {
        // ignore
      }
    }
  }

  return pages;
}

module.exports = { extractPdfPagesText };


