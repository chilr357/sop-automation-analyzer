import React, { useState, useCallback } from 'react';
import { FileUpload } from './components/FileUpload';
import { ResultsDisplay } from './components/ResultsDisplay';
import { AlertTriangleIcon } from './components/IconComponents';
import { analyzeSOP } from './services/geminiService';
import type { AnalysisReport } from './types';

type AnalysisEntry = { fileName: string; fileUrl: string; report: AnalysisReport };

const App: React.FC = () => {
  const [analysisReports, setAnalysisReports] = useState<AnalysisEntry[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errors, setErrors] = useState<{ fileName: string; message: string }[]>([]);

  const handleAnalyze = useCallback(async (files: File[]) => {
    setIsLoading(true);
    setErrors([]);
    setAnalysisReports(previousReports => {
      previousReports.forEach(report => URL.revokeObjectURL(report.fileUrl));
      return [];
    });

    const results = await Promise.allSettled(files.map(file => analyzeSOP(file)));

    const newReports: AnalysisEntry[] = [];
    const newErrors: { fileName: string; message: string }[] = [];

    results.forEach((result, index) => {
      const fileName = files[index].name;
      if (result.status === 'fulfilled') {
        const fileUrl = URL.createObjectURL(files[index]);
        newReports.push({ fileName, fileUrl, report: result.value });
      } else {
        const errorMessage = result.reason instanceof Error ? result.reason.message : 'An unexpected error occurred.';
        newErrors.push({ fileName, message: errorMessage });
      }
    });

    setAnalysisReports(newReports);
    setErrors(newErrors);
    setIsLoading(false);
  }, []);

  React.useEffect(() => {
    return () => {
      analysisReports.forEach(report => URL.revokeObjectURL(report.fileUrl));
    };
  }, [analysisReports]);

  const Header: React.FC = () => (
    <header className="text-center p-8">
      <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl md:text-6xl">
        Digital Process <span className="text-brand-blue">Automation Analyzer</span>
      </h1>
      <p className="mt-3 max-w-md mx-auto text-base text-brand-gray sm:text-lg md:mt-5 md:text-xl md:max-w-3xl">
        Leverage AI to analyze your Standard Operating Procedures, identify automation opportunities, and enhance operational efficiency.
      </p>
    </header>
  );

  const LoadingIndicator: React.FC = () => (
    <div className="mt-12 text-center">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-brand-blue"></div>
        <p className="mt-4 text-lg text-brand-gray">Analyzing documents... This may take a moment.</p>
    </div>
  );

  const ErrorDisplay: React.FC<{ errors: {fileName: string; message: string}[] }> = ({ errors }) => (
    <div className="mt-8 max-w-2xl mx-auto p-4 bg-red-500/10 border border-red-500/30 rounded-lg space-y-4">
        <div className="flex items-start space-x-3">
            <AlertTriangleIcon className="w-6 h-6 text-red-400 flex-shrink-0 mt-1" />
            <div>
                <h3 className="font-bold text-red-400">Analysis failed for {errors.length} document(s)</h3>
                <ul className="text-sm text-red-300 list-disc list-inside mt-2 space-y-1">
                {errors.map((err, index) => (
                    <li key={index}><strong>{err.fileName}:</strong> {err.message}</li>
                ))}
                </ul>
            </div>
        </div>
    </div>
  );


  return (
    <div className="min-h-screen bg-brand-dark px-4 pb-20">
      <main className="container mx-auto">
        <Header />
        <FileUpload onAnalyze={handleAnalyze} isLoading={isLoading} />
        {isLoading && <LoadingIndicator />}
        {errors.length > 0 && <ErrorDisplay errors={errors} />}
        {analysisReports.length > 0 && <ResultsDisplay reports={analysisReports} />}
      </main>
    </div>
  );
};

export default App;
