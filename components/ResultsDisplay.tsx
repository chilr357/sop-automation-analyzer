import React, { useState } from 'react';
import type { AnalysisReport } from '../types';

const SummaryCard: React.FC<{ title: string; value: string | number; className?: string }> = ({ title, value, className = '' }) => (
  <div className={`bg-brand-light p-4 rounded-lg border border-brand-border ${className}`}>
    <p className="text-sm text-brand-gray">{title}</p>
    <p className="text-xl lg:text-2xl font-bold mt-1 text-white">{value}</p>
  </div>
);

const getComplexityColor = (complexity: 'Low' | 'Medium' | 'High') => {
    switch (complexity) {
        case 'Low': return 'bg-green-500/20 text-green-400 border-green-500/30';
        case 'Medium': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
        case 'High': return 'bg-red-500/20 text-red-400 border-red-500/30';
        default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
};

const getRoiColor = (roi: 'Low' | 'Medium' | 'High') => {
     switch (roi) {
        case 'Low': return 'text-red-400';
        case 'Medium': return 'text-yellow-400';
        case 'High': return 'text-green-400';
        default: return 'text-gray-400';
    }
}

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="bg-brand-light border border-brand-border rounded-lg p-6 mb-8">
    <h3 className="text-2xl font-bold text-white mb-4 border-b border-brand-border pb-3">{title}</h3>
    {children}
  </div>
);

const SingleReportView: React.FC<{ report: AnalysisReport; fileUrl: string }> = ({ report, fileUrl }) => {
    const { executiveSummary, detailedAnalysis } = report;

    return (
        <div className="space-y-8 pt-6">
            <Section title="Executive Summary">
                <h2 className="text-3xl font-bold text-center mb-6 text-brand-blue">{executiveSummary.sopTitle}</h2>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                    <SummaryCard title="Manual Touchpoints" value={executiveSummary.totalManualTouchpoints} />
                    <SummaryCard title="Automation Potential" value={executiveSummary.automationPotentialScore} className="text-green-400"/>
                    <SummaryCard title="Time Savings Est." value={executiveSummary.timeSavingsEstimate} />
                    <SummaryCard title="Error Reduction" value={executiveSummary.errorReductionProjection} />
                    <SummaryCard title="Priority" value={executiveSummary.implementationPriority} className="text-yellow-400"/>
                </div>
            </Section>

            <Section title="Automation Opportunities Matrix">
                <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-brand-border">
                    <thead className="bg-gray-800/50">
                    <tr>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-brand-gray uppercase tracking-wider">SOP Reference</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-brand-gray uppercase tracking-wider">Current Process</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-brand-gray uppercase tracking-wider">Proposed Solution</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-brand-gray uppercase tracking-wider">Complexity</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-brand-gray uppercase tracking-wider">ROI</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-brand-gray uppercase tracking-wider">Timeline</th>
                    </tr>
                    </thead>
                    <tbody className="bg-brand-light divide-y divide-brand-border">
                    {detailedAnalysis.automationOpportunities.map((opp, index) => (
                        <tr key={index} className="hover:bg-brand-border/30 transition-colors">
                        <td className="px-6 py-4 whitespace-normal text-sm text-brand-blue">
                            {opp.sopReference ? (
                                <a
                                    href={`${fileUrl}#page=${opp.sopReference.pageNumber}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="underline underline-offset-2"
                                >
                                    {opp.sopReference.stepIdentifier}
                                </a>
                            ) : (
                                <span className="text-brand-gray">N/A</span>
                            )}
                        </td>
                        <td className="px-6 py-4 whitespace-normal text-sm text-white">{opp.currentManualProcess}</td>
                        <td className="px-6 py-4 whitespace-normal text-sm text-brand-gray">{opp.proposedAutomationSolution}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                            <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full border ${getComplexityColor(opp.implementationComplexity)}`}>
                                {opp.implementationComplexity}
                            </span>
                        </td>
                        <td className={`px-6 py-4 whitespace-nowrap text-sm font-bold ${getRoiColor(opp.roiPotential)}`}>{opp.roiPotential}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-brand-gray">{opp.timelineEstimate}</td>
                        </tr>
                    ))}
                    </tbody>
                </table>
                </div>
            </Section>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <Section title="Implementation Roadmap">
                    <div className="space-y-4">
                    {detailedAnalysis.implementationRoadmap.map((phase, index) => (
                        <div key={index} className="p-4 border border-brand-border rounded-md bg-gray-800/50">
                            <h4 className="font-bold text-brand-blue">{phase.phase}</h4>
                            <p className="text-sm text-brand-gray mt-1">{phase.description}</p>
                        </div>
                    ))}
                    </div>
                </Section>
                <Section title="Current State Analysis">
                    <div className="space-y-4 text-sm text-brand-gray">
                        <div>
                            <h4 className="font-semibold text-white">Key Bottlenecks</h4>
                            <p>{detailedAnalysis.currentState.bottleneckIdentification}</p>
                        </div>
                        <div>
                            <h4 className="font-semibold text-white">Data Flow</h4>
                            <p>{detailedAnalysis.currentState.dataFlowMapping}</p>
                        </div>
                    </div>
                </Section>
            </div>
        </div>
    );
};

interface ReportWithFile {
  fileName: string;
  fileUrl: string;
  report: AnalysisReport;
}

interface ResultsDisplayProps {
  reports: ReportWithFile[];
}

export const ResultsDisplay: React.FC<ResultsDisplayProps> = ({ reports }) => {
  const [activeTabIndex, setActiveTabIndex] = useState(0);

  if (reports.length === 0) {
    return null;
  }
  
  const activeReport = reports[activeTabIndex];

  return (
    <div className="w-full max-w-7xl mx-auto mt-12">
      <div className="border-b border-brand-border">
        <nav className="-mb-px flex space-x-4 overflow-x-auto" aria-label="Tabs">
          {reports.map((item, index) => (
            <button
              key={item.fileName}
              onClick={() => setActiveTabIndex(index)}
              className={`${
                index === activeTabIndex
                  ? 'border-brand-blue text-brand-blue'
                  : 'border-transparent text-brand-gray hover:text-white hover:border-gray-500'
              } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors duration-200 focus:outline-none`}
              aria-current={index === activeTabIndex ? 'page' : undefined}
            >
              {item.fileName}
            </button>
          ))}
        </nav>
      </div>
      
      {activeReport && <SingleReportView report={activeReport.report} fileUrl={activeReport.fileUrl} />}

    </div>
  );
};
