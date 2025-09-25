
export interface ExecutiveSummary {
  sopTitle: string;
  complexityScore: string;
  processEfficiencyRating: string;
  totalManualTouchpoints: number;
  automationPotentialScore: string;
  timeSavingsEstimate: string;
  errorReductionProjection: string;
  complianceRiskMitigation: string;
  implementationPriority: string;
}

export interface CurrentState {
  processBreakdown: string[];
  manualTouchpointInventory: string[];
  dataFlowMapping: string;
  bottleneckIdentification: string;
}

export interface AutomationOpportunity {
  opportunityCategory: string;
  sopReference: {
    stepIdentifier: string;
    pageNumber: number;
  };
  currentManualProcess: string;
  proposedAutomationSolution: string;
  technologyRequired: string;
  implementationComplexity: 'Low' | 'Medium' | 'High';
  roiPotential: 'Low' | 'Medium' | 'High';
  complianceImpact: string;
  timelineEstimate: string;
}

export interface ImplementationPhase {
  phase: string;
  description: string;
}

export interface TechnicalRequirements {
  platformRequirements: string;
  trainingRequirements: string;
  budgetEstimate: string;
  riskMitigation: string;
}

export interface AnalysisReport {
  executiveSummary: ExecutiveSummary;
  detailedAnalysis: {
    currentState: CurrentState;
    automationOpportunities: AutomationOpportunity[];
    implementationRoadmap: ImplementationPhase[];
    technicalRequirements: TechnicalRequirements;
  };
}
