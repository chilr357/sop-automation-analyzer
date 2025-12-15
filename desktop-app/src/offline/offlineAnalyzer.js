const { AnalysisReportSchema } = require('./reportSchema');
const { extractPdfPagesText } = require('./pdfTextExtractor');
const { runLlamaJson } = require('./llamaRunner');

const MAX_PROMPT_CHARS = 120_000;

function buildPrompt({ pages }) {
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
  if (full.length <= MAX_PROMPT_CHARS) {
    return full;
  }

  // If the PDF is very long, truncate while preserving early pages (often contain scope/definitions)
  // and later pages (often contain forms/records/review steps).
  const head = full.slice(0, Math.floor(MAX_PROMPT_CHARS * 0.7));
  const tail = full.slice(-Math.floor(MAX_PROMPT_CHARS * 0.3));
  return `${head}\n\n[TRUNCATED]\n\n${tail}`;
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


