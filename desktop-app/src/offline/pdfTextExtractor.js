const fs = require('node:fs/promises');

/**
 * Extract per-page text from a text-based PDF.
 * Uses pdfjs-dist (loaded via dynamic import because it is ESM).
 *
 * @param {string} filePath
 * @returns {Promise<Array<{pageNumber: number, text: string}>>}
 */
async function extractPdfPagesText(filePath) {
  const data = await fs.readFile(filePath);

  // pdfjs-dist ships ESM. Use the legacy build which supports Node-style usage.
  // Path reference: pdfjs-dist/legacy/build/pdf.mjs
  // eslint-disable-next-line no-unused-vars
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

  // In Electron/Node contexts, disabling the worker avoids workerSrc resolution issues.
  const loadingTask = pdfjs.getDocument({ data, disableWorker: true });
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
  }

  return pages;
}

module.exports = { extractPdfPagesText };


