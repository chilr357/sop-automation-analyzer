import React, { useState, useCallback } from 'react';
import { FileUpload } from './components/FileUpload';
import { DesktopFilePicker, type DesktopPickedFile } from './components/DesktopFilePicker';
import { ResultsDisplay } from './components/ResultsDisplay';
import { AlertTriangleIcon } from './components/IconComponents';
import { analyzeSOP } from './services/geminiService';
import type { AnalysisReport } from './types';

type AnalysisEntry = { fileName: string; fileUrl: string; report: AnalysisReport };

const App: React.FC = () => {
  const [analysisReports, setAnalysisReports] = useState<AnalysisEntry[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errors, setErrors] = useState<{ fileName: string; message: string }[]>([]);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<{ status: string; percent?: number; message?: string } | null>(null);
  const [updateActionMessage, setUpdateActionMessage] = useState<string | null>(null);
  const [analysisStartTs, setAnalysisStartTs] = useState<number | null>(null);
  const [analysisElapsedMs, setAnalysisElapsedMs] = useState<number | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState<number | null>(null);
  const [analysisStage, setAnalysisStage] = useState<string | null>(null);

  const clearPreviousReports = useCallback(() => {
    setAnalysisReports((previousReports) => {
      previousReports.forEach((report) => {
        // Only blob: URLs should be revoked.
        if (report.fileUrl.startsWith('blob:')) {
          URL.revokeObjectURL(report.fileUrl);
        }
      });
      return [];
    });
  }, []);

  const handleAnalyze = useCallback(async (files: File[]) => {
    setIsLoading(true);
    setErrors([]);
    clearPreviousReports();

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
  }, [clearPreviousReports]);

  const handleAnalyzeDesktop = useCallback(async (files: DesktopPickedFile[]) => {
    setIsLoading(true);
    setErrors([]);
    clearPreviousReports();
    setAnalysisStartTs(Date.now());
    setAnalysisElapsedMs(0);
    setAnalysisProgress(0);
    setAnalysisStage('Starting…');

    try {
      const api = window.desktopAPI;
      if (!api?.analyzePdfPaths) {
        throw new Error('Offline analysis API is unavailable.');
      }

      const filePaths = files.map((f) => f.path);
      const results = await api.analyzePdfPaths(filePaths);

      const newReports: AnalysisEntry[] = [];
      const newErrors: { fileName: string; message: string }[] = [];

      results.forEach((result) => {
        const f = files.find((x) => x.path === result.filePath);
        const fileName = f?.name ?? result.filePath;
        const fileUrl = f?.url ?? result.filePath;

        if (result.ok) {
          newReports.push({ fileName, fileUrl, report: result.report });
        } else {
          newErrors.push({ fileName, message: result.error });
        }
      });

      setAnalysisReports(newReports);
      setErrors(newErrors);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Offline analysis failed.';
      setErrors([{ fileName: 'Offline Analysis', message: msg }]);
    } finally {
      setIsLoading(false);
      setAnalysisStage(null);
    }
  }, [clearPreviousReports]);

  React.useEffect(() => {
    return () => {
      analysisReports.forEach((report) => {
        if (report.fileUrl.startsWith('blob:')) {
          URL.revokeObjectURL(report.fileUrl);
        }
      });
    };
  }, [analysisReports]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const info = await window.desktopAPI?.getAppInfo?.();
        if (!cancelled && info?.version) setAppVersion(info.version);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    const api = window.desktopAPI;
    if (!api?.onAnalysisProgress) return;
    const unsubscribe = api.onAnalysisProgress((payload) => {
      if (!payload || typeof payload !== 'object') return;
      if (typeof payload.percent === 'number') setAnalysisProgress(payload.percent);
      if (typeof payload.stage === 'string') {
        const stage =
          payload.stage === 'extract' ? 'Extracting text…' :
          payload.stage === 'ocr' ? 'Running OCR…' :
          payload.stage === 'prompt' ? 'Preparing prompt…' :
          payload.stage === 'llama' ? 'Running offline model…' :
          payload.stage === 'parse' ? 'Parsing results…' :
          payload.stage === 'done' ? 'Done' :
          payload.stage === 'error' ? 'Error' :
          payload.stage;
        setAnalysisStage(stage);
      }
    });
    return () => {
      try {
        unsubscribe?.();
      } catch {
        // ignore
      }
    };
  }, []);

  React.useEffect(() => {
    if (!isLoading || !analysisStartTs) return;
    const t = setInterval(() => {
      setAnalysisElapsedMs(Date.now() - analysisStartTs);
    }, 250);
    return () => clearInterval(t);
  }, [isLoading, analysisStartTs]);

  React.useEffect(() => {
    if (!isLoading && analysisStartTs) {
      setAnalysisElapsedMs(Date.now() - analysisStartTs);
      setAnalysisStartTs(null);
    }
  }, [isLoading, analysisStartTs]);

  React.useEffect(() => {
    const api = window.desktopAPI;
    if (!api?.onUpdateStatus) return;
    const unsubscribe = api.onUpdateStatus((payload) => {
      if (payload && typeof payload === 'object' && typeof payload.status === 'string') {
        setUpdateStatus(payload);
      }
    });
    return () => {
      try {
        unsubscribe?.();
      } catch {
        // ignore
      }
    };
  }, []);

  const handleCheckForUpdates = useCallback(async () => {
    setUpdateActionMessage(null);
    const api = window.desktopAPI;
    if (!api?.checkForUpdates) {
      setUpdateActionMessage('Updates are not available in this mode.');
      return;
    }
    try {
      const res = await api.checkForUpdates();
      if (!res?.ok) {
        setUpdateActionMessage(res?.message || 'Update check failed.');
        return;
      }
      setUpdateActionMessage('Checked for updates.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Update check failed.';
      setUpdateActionMessage(msg);
    }
  }, []);

  const handleRestartToUpdate = useCallback(async () => {
    const api = window.desktopAPI;
    if (!api?.quitAndInstallUpdate) return;
    await api.quitAndInstallUpdate();
  }, []);

  const UpdateControls: React.FC = () => {
    if (!window.desktopAPI?.checkForUpdates) return null;
    const status = updateStatus?.status;
    const percent = updateStatus?.percent;
    const statusText =
      status === 'checking' ? 'Checking for updates…' :
      status === 'available' ? 'Update found. Downloading…' :
      status === 'downloading' ? `Downloading update…${typeof percent === 'number' ? ` ${percent.toFixed(0)}%` : ''}` :
      status === 'downloaded' ? 'Update downloaded.' :
      status === 'not-available' ? 'You’re up to date.' :
      status === 'error' ? `Update error: ${updateStatus?.message || 'Unknown error'}` :
      null;

    return (
      <div className="mt-3 flex flex-col items-center gap-2">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleCheckForUpdates}
            className="px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/15 text-white text-sm border border-white/10"
          >
            Software Update
          </button>
          {status === 'downloaded' ? (
            <button
              type="button"
              onClick={handleRestartToUpdate}
              className="px-3 py-1.5 rounded-md bg-brand-blue hover:bg-brand-blue/90 text-white text-sm"
            >
              Restart to Update
            </button>
          ) : null}
        </div>
        {statusText ? <div className="text-xs text-brand-gray/90">{statusText}</div> : null}
        {updateActionMessage ? <div className="text-xs text-brand-gray/80">{updateActionMessage}</div> : null}
      </div>
    );
  };

  const Header: React.FC = () => (
    <header className="text-center p-8">
      <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl md:text-6xl">
        Digital Process <span className="text-brand-blue">Automation Analyzer</span>
      </h1>
      {appVersion ? (
        <p className="mt-2 text-sm text-brand-gray/80">v{appVersion}</p>
      ) : null}
      <UpdateControls />
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
        {window.desktopAPI?.pickPdfFiles ? (
          <DesktopFilePicker
            onAnalyzePaths={handleAnalyzeDesktop}
            isLoading={isLoading}
            analysisElapsedMs={analysisElapsedMs}
            analysisProgress={analysisProgress}
            analysisStage={analysisStage}
          />
        ) : (
          <FileUpload onAnalyze={handleAnalyze} isLoading={isLoading} />
        )}
        {isLoading && <LoadingIndicator />}
        {errors.length > 0 && <ErrorDisplay errors={errors} />}
        {analysisReports.length > 0 && <ResultsDisplay reports={analysisReports} />}
      </main>
    </div>
  );
};

export default App;
