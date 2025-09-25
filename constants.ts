
import { Type } from "@google/genai";
import type { OpenAPISchema } from "@google/genai";

export const SYSTEM_PROMPT = `
You are an Expert Pharmaceutical Manufacturing Process Optimization Specialist with over 20 years of specialized experience in pharmaceutical manufacturing operations, regulatory compliance, and automation implementation. Your expertise encompasses FDA cGMP compliance, lean manufacturing methodologies, digital transformation, MES, process automation, data integrity standards, and risk assessment protocols.

Your Primary Objective: Analyze the uploaded pharmaceutical SOP PDF document to identify comprehensive automation opportunities that reduce manual processes, eliminate human error, optimize operational efficiency, and maintain strict pharmaceutical compliance standards while leveraging AI-driven solutions.

Follow this analysis framework:

1.  **Complete Document Analysis**: Systematically extract and catalog EVERY procedural step. Identify all decision points, approval gates, quality checkpoints, and regulatory compliance touchpoints. Map the complete data flow. Catalog all instances of manual data entry, calculations, transcription, and paper-based processes. Document waiting periods, queue times, and bottlenecks.

2.  **Automation Opportunity Identification**: Identify opportunities in these categories:
    *   **Manual Data Entry Elimination**: Transcription between systems (ERP, MES, LIMS, QMS), repetitive data entry, paper-based capture, manual calculations, redundant data verification.
    *   **System Integration & Digital Transformation**: Real-time data sync, electronic signature workflows, automated report generation, IoT integration, automated compliance checking, digital batch records.
    *   **Advanced Automation Technologies**: RPA, AI-powered document processing, computer vision for inspection, ML for predictive maintenance, NLP for compliance checking.
    *   **Process Optimization & Lean Implementation**: Eliminating redundant approvals, real-time quality monitoring, predictive analytics, automated exception handling.

3.  **Structured Output Generation**: You MUST return your complete analysis as a single JSON object that strictly adheres to the provided response schema. Do not return any text, markdown, or code outside of this JSON object. The entire output must be a valid JSON.

Analyze the provided SOP document according to this framework and return the comprehensive analysis.

For every current manual process that you list in the automation opportunities matrix, include an explicit reference to the originating SOP step. Provide the exact step identifier or section heading plus a concise descriptor (e.g., "Section 5.3 – Solution Preparation Initiation") and the 1-indexed page number within the SOP PDF where that step appears. Ensure the page numbers align with the PDF pagination so a reader can jump directly to the relevant page.
`;

export const RESPONSE_SCHEMA: OpenAPISchema = {
  type: Type.OBJECT,
  properties: {
    executiveSummary: {
      type: Type.OBJECT,
      description: "A high-level overview of the analysis.",
      properties: {
        sopTitle: { type: Type.STRING, description: "Title of the SOP document." },
        complexityScore: { type: Type.STRING, description: "e.g., 'Medium (7/10)'" },
        processEfficiencyRating: { type: Type.STRING, description: "e.g., 'Low (45%)'" },
        totalManualTouchpoints: { type: Type.INTEGER, description: "Total number of manual steps identified." },
        automationPotentialScore: { type: Type.STRING, description: "e.g., 'High (85%)'" },
        timeSavingsEstimate: { type: Type.STRING, description: "e.g., 'Est. 40-50 hours/month'" },
        errorReductionProjection: { type: Type.STRING, description: "e.g., 'Up to 90% reduction in data entry errors'" },
        complianceRiskMitigation: { type: Type.STRING, description: "Summary of how automation improves compliance." },
        implementationPriority: { type: Type.STRING, description: "e.g., 'High'" },
      },
      required: ["sopTitle", "complexityScore", "processEfficiencyRating", "totalManualTouchpoints", "automationPotentialScore", "timeSavingsEstimate", "errorReductionProjection", "complianceRiskMitigation", "implementationPriority"]
    },
    detailedAnalysis: {
      type: Type.OBJECT,
      properties: {
        currentState: {
          type: Type.OBJECT,
          description: "Documentation of the current process.",
          properties: {
            processBreakdown: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Step-by-step breakdown of the current process." },
            manualTouchpointInventory: { type: Type.ARRAY, items: { type: Type.STRING }, description: "List of all manual activities." },
            dataFlowMapping: { type: Type.STRING, description: "Description of how data moves through the process." },
            bottleneckIdentification: { type: Type.STRING, description: "Key bottlenecks and their impact." }
          },
          required: ["processBreakdown", "manualTouchpointInventory", "dataFlowMapping", "bottleneckIdentification"]
        },
        automationOpportunities: {
          type: Type.ARRAY,
          description: "A matrix of identified automation opportunities.",
          items: {
            type: Type.OBJECT,
            properties: {
              opportunityCategory: { type: Type.STRING },
              sopReference: {
                type: Type.OBJECT,
                properties: {
                  stepIdentifier: { type: Type.STRING, description: "Exact SOP step or section heading" },
                  pageNumber: { type: Type.INTEGER, description: "1-indexed page number within the SOP PDF" }
                },
                required: ["stepIdentifier", "pageNumber"]
              },
              currentManualProcess: { type: Type.STRING },
              proposedAutomationSolution: { type: Type.STRING },
              technologyRequired: { type: Type.STRING },
              implementationComplexity: { type: Type.STRING, enum: ['Low', 'Medium', 'High'] },
              roiPotential: { type: Type.STRING, enum: ['Low', 'Medium', 'High'] },
              complianceImpact: { type: Type.STRING },
              timelineEstimate: { type: Type.STRING }
            },
             required: ["opportunityCategory", "sopReference", "currentManualProcess", "proposedAutomationSolution", "technologyRequired", "implementationComplexity", "roiPotential", "complianceImpact", "timelineEstimate"]
          }
        },
        implementationRoadmap: {
          type: Type.ARRAY,
          description: "A phased plan for implementation.",
          items: {
            type: Type.OBJECT,
            properties: {
              phase: { type: Type.STRING, description: "e.g., 'Phase 1 (Quick Wins - 0-6 months)'" },
              description: { type: Type.STRING, description: "Description of activities in this phase." }
            },
            required: ["phase", "description"]
          }
        },
        technicalRequirements: {
          type: Type.OBJECT,
          description: "Technical and resource planning.",
          properties: {
            platformRequirements: { type: Type.STRING },
            trainingRequirements: { type: Type.STRING },
            budgetEstimate: { type: Type.STRING },
            riskMitigation: { type: Type.STRING }
          },
          required: ["platformRequirements", "trainingRequirements", "budgetEstimate", "riskMitigation"]
        }
      },
      required: ["currentState", "automationOpportunities", "implementationRoadmap", "technicalRequirements"]
    }
  },
  required: ["executiveSummary", "detailedAnalysis"]
};
