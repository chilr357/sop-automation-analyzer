const { z } = require('zod');

// Mirrors the shape of `AnalysisReport` in the web app (`/types.ts`).
// Keep this schema in sync with the UI expectations.
const ExecutiveSummarySchema = z.object({
  sopTitle: z.string(),
  complexityScore: z.string(),
  processEfficiencyRating: z.string(),
  totalManualTouchpoints: z.number().int().nonnegative(),
  automationPotentialScore: z.string(),
  timeSavingsEstimate: z.string(),
  errorReductionProjection: z.string(),
  complianceRiskMitigation: z.string(),
  implementationPriority: z.string()
});

const CurrentStateSchema = z.object({
  processBreakdown: z.array(z.string()),
  manualTouchpointInventory: z.array(z.string()),
  dataFlowMapping: z.string(),
  bottleneckIdentification: z.string()
});

const AutomationOpportunitySchema = z.object({
  opportunityCategory: z.string(),
  sopReference: z.object({
    stepIdentifier: z.string(),
    pageNumber: z.number().int().positive()
  }),
  currentManualProcess: z.string(),
  proposedAutomationSolution: z.string(),
  technologyRequired: z.string(),
  implementationComplexity: z.enum(['Low', 'Medium', 'High']),
  roiPotential: z.enum(['Low', 'Medium', 'High']),
  complianceImpact: z.string(),
  timelineEstimate: z.string()
});

const ImplementationPhaseSchema = z.object({
  phase: z.string(),
  description: z.string()
});

const TechnicalRequirementsSchema = z.object({
  platformRequirements: z.string(),
  trainingRequirements: z.string(),
  budgetEstimate: z.string(),
  riskMitigation: z.string()
});

const AnalysisReportSchema = z.object({
  executiveSummary: ExecutiveSummarySchema,
  detailedAnalysis: z.object({
    currentState: CurrentStateSchema,
    automationOpportunities: z.array(AutomationOpportunitySchema),
    implementationRoadmap: z.array(ImplementationPhaseSchema),
    technicalRequirements: TechnicalRequirementsSchema
  })
});

module.exports = { AnalysisReportSchema };


