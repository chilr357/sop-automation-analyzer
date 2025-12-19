const { AnalysisReportSchema } = require('./reportSchema');
const { extractPdfPagesText } = require('./pdfTextExtractor');
const { runLlamaJson } = require('./llamaRunner');

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
    '- Output MUST match the schema described below.',
    '- Every automation opportunity MUST include sopReference.stepIdentifier and sopReference.pageNumber (1-indexed).',
    '',
    'Schema (high-level):',
    '{',
    '  "executiveSummary": {',
    '    "sopTitle": string, "complexityScore": string, "processEfficiencyRating": string,',
    '    "totalManualTouchpoints": number, "automationPotentialScore": string,',
    '    "timeSavingsEstimate": string, "errorReductionProjection": string,',
    '    "complianceRiskMitigation": string, "implementationPriority": string',
    '  },',
    '  "detailedAnalysis": {',
    '    "currentState": { "processBreakdown": string[], "manualTouchpointInventory": string[], "dataFlowMapping": string, "bottleneckIdentification": string },',
    '    "automationOpportunities": [{',
    '      "opportunityCategory": string,',
    '      "sopReference": { "stepIdentifier": string, "pageNumber": number },',
    '      "currentManualProcess": string, "proposedAutomationSolution": string, "technologyRequired": string,',
    '      "implementationComplexity": "Low"|"Medium"|"High",',
    '      "roiPotential": "Low"|"Medium"|"High",',
    '      "complianceImpact": string, "timelineEstimate": string',
    '    }],',
    '    "implementationRoadmap": [{ "phase": string, "description": string }],',
    '    "technicalRequirements": { "platformRequirements": string, "trainingRequirements": string, "budgetEstimate": string, "riskMitigation": string }',
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
  const pages = await extractPdfPagesText(filePath);
  const prompt = buildPrompt({ pages });

  const data = await runLlamaJson({ prompt });
  const parsed = AnalysisReportSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`Offline analysis produced invalid JSON schema: ${parsed.error.message}`);
  }
  return parsed.data;
}

module.exports = { analyzePdfAtPath };



