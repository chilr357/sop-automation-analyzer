const { AnalysisReportSchema } = require('./reportSchema');
const { extractPdfPagesText } = require('./pdfTextExtractor');
const { runLlamaJson } = require('./llamaRunner');
const { ocrToSearchablePdfBestEffort, hasOcrMyPdf } = require('./ocrRunner');

// We must keep the prompt within the model context window.
// We don't have an exact tokenizer here, so we use a conservative chars->tokens estimate.
const APPROX_CHARS_PER_TOKEN = 4;
const DEFAULT_CTX_SIZE = 4096;
const DEFAULT_N_PREDICT = 1536;
const SAFETY_TOKENS = 256;

function buildPrompt({ pages, ctxSize = DEFAULT_CTX_SIZE, nPredict = DEFAULT_N_PREDICT }) {
  // Keep the prompt deterministic and highly structured to maximize JSON compliance.
  const header = [
    'You are an Expert Pharmaceutical Manufacturing Process Optimization Specialist.',
    '',
    'Task: Analyze the following SOP (PDF text extracted per page) and return ONLY a single JSON object.',
    'Requirements:',
    '- Output MUST be valid JSON (no markdown, no commentary).',
    '- Output MUST match the JSON template below (same keys and structure).',
    '- Use proper JSON types: strings MUST be quoted, numbers MUST be numbers.',
    '- Every automation opportunity MUST include sopReference.stepIdentifier and sopReference.pageNumber (1-indexed).',
    '',
    'JSON template (fill in values; arrays may be empty if not applicable):',
    '{',
    '  "executiveSummary": {',
    '    "sopTitle": "",',
    '    "complexityScore": "",',
    '    "processEfficiencyRating": "",',
    '    "totalManualTouchpoints": 0,',
    '    "automationPotentialScore": "",',
    '    "timeSavingsEstimate": "",',
    '    "errorReductionProjection": "",',
    '    "complianceRiskMitigation": "",',
    '    "implementationPriority": ""',
    '  },',
    '  "detailedAnalysis": {',
    '    "currentState": {',
    '      "processBreakdown": [],',
    '      "manualTouchpointInventory": [],',
    '      "dataFlowMapping": "",',
    '      "bottleneckIdentification": ""',
    '    },',
    '    "automationOpportunities": [',
    '      {',
    '        "opportunityCategory": "",',
    '        "sopReference": { "stepIdentifier": "", "pageNumber": 1 },',
    '        "currentManualProcess": "",',
    '        "proposedAutomationSolution": "",',
    '        "technologyRequired": "",',
    '        "implementationComplexity": "Low",',
    '        "roiPotential": "Low",',
    '        "complianceImpact": "",',
    '        "timelineEstimate": ""',
    '      }',
    '    ],',
    '    "implementationRoadmap": [',
    '      { "phase": "", "description": "" }',
    '    ],',
    '    "technicalRequirements": {',
    '      "platformRequirements": "",',
    '      "trainingRequirements": "",',
    '      "budgetEstimate": "",',
    '      "riskMitigation": ""',
    '    }',
    '  }',
    '}',
    '',
    'SOP content (page-delimited):'
  ].join('\n');

  const bodyParts = [];
  for (const p of pages) {
    bodyParts.push(`\n--- PAGE ${p.pageNumber} ---\n${p.text || ''}`);
  }

  const full = header + bodyParts.join('');

  // Budget: prompt tokens + predicted tokens must fit ctx window.
  const maxPromptTokens = Math.max(512, ctxSize - nPredict - SAFETY_TOKENS);
  const maxPromptChars = maxPromptTokens * APPROX_CHARS_PER_TOKEN;
  if (full.length <= maxPromptChars) return full;

  // If the PDF is very long, truncate while preserving early pages (often contain scope/definitions)
  // and later pages (often contain forms/records/review steps).
  const head = full.slice(0, Math.floor(maxPromptChars * 0.7));
  const tail = full.slice(-Math.floor(maxPromptChars * 0.3));
  return `${head}\n\n[TRUNCATED TO FIT CONTEXT]\n\n${tail}`;
}

async function analyzePdfAtPath(filePath) {
  let pages = await extractPdfPagesText(filePath);
  let totalChars = pages.reduce((sum, p) => sum + (p.text ? p.text.length : 0), 0);
  let nonEmptyPages = pages.reduce((sum, p) => sum + (p.text && p.text.trim().length > 0 ? 1 : 0), 0);

  // If we can't extract text, the offline model is effectively "blind" (common for scanned/image PDFs).
  // Online Gemini can still perform OCR-like understanding because it ingests the PDF directly.
  if (nonEmptyPages === 0 || totalChars < 500) {
    // Best-effort OCR fallback if user has `ocrmypdf` installed.
    const ocrAvailable = await hasOcrMyPdf();
    if (ocrAvailable) {
      const ocrPdfPath = await ocrToSearchablePdfBestEffort(filePath);
      if (ocrPdfPath) {
        pages = await extractPdfPagesText(ocrPdfPath);
        totalChars = pages.reduce((sum, p) => sum + (p.text ? p.text.length : 0), 0);
        nonEmptyPages = pages.reduce((sum, p) => sum + (p.text && p.text.trim().length > 0 ? 1 : 0), 0);
      }
    }

    if (nonEmptyPages === 0 || totalChars < 500) {
      const base = [
        'Offline analysis could not extract readable text from this PDF.',
        `Extracted text: ${totalChars} characters across ${nonEmptyPages}/${pages.length} pages.`,
        'This usually means the PDF is scanned (image-only) or otherwise has no selectable text layer.'
      ];
      const next = ocrAvailable
        ? [
            'An OCR attempt was made using `ocrmypdf`, but the resulting text was still too small.',
            'Fix options: (1) Use Online mode for this document, or (2) run OCR externally to create a searchable PDF, then retry Offline mode.'
          ]
        : [
            'Fix options: (1) Use Online mode for this document, or (2) install an OCR tool and retry.',
            'To enable automatic offline OCR fallback, install `ocrmypdf` and ensure it is on PATH, then retry.'
          ];
      throw new Error(base.concat(next).join(' '));
    }
  }
  const prompt = buildPrompt({ pages });

  const data = await runLlamaJson({ prompt });
  const parsed = AnalysisReportSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`Offline analysis produced invalid JSON schema: ${parsed.error.message}`);
  }
  return parsed.data;
}

module.exports = { analyzePdfAtPath };



