import React, { useCallback, useState } from 'react';
import { DocumentIcon, XIcon } from './IconComponents';

export type DesktopPickedFile = { path: string; name: string; url: string };

interface DesktopFilePickerProps {
  isLoading: boolean;
  onAnalyzePaths: (files: DesktopPickedFile[]) => void;
  analysisElapsedMs?: number | null;
  analysisProgress?: number | null;
  analysisStage?: string | null;
}

export const DesktopFilePicker: React.FC<DesktopFilePickerProps> = ({ isLoading, onAnalyzePaths, analysisElapsedMs, analysisProgress, analysisStage }) => {
  const [selectedFiles, setSelectedFiles] = useState<DesktopPickedFile[]>([]);
  const [pickError, setPickError] = useState<string | null>(null);
  const [offlineStatus, setOfflineStatus] = useState<{ installed: boolean; url: string; baseDir?: string } | null>(null);
  const [offlineInstallError, setOfflineInstallError] = useState<string | null>(null);
  const [isInstallingOffline, setIsInstallingOffline] = useState(false);
  const [isInstallingFromZip, setIsInstallingFromZip] = useState(false);
  const [offlineUpdateInfo, setOfflineUpdateInfo] = useState<{ installedVersion?: string | null; remoteVersion?: string | null; updateAvailable?: boolean } | null>(null);
  const [offlineUpdateStatus, setOfflineUpdateStatus] = useState<{ status: string; component?: string; percent?: number; message?: string } | null>(null);
  const [isCheckingOfflineUpdate, setIsCheckingOfflineUpdate] = useState(false);
  const [isUpdatingOfflinePack, setIsUpdatingOfflinePack] = useState(false);

  const refreshOfflineStatus = useCallback(async () => {
    let cancelled = false;
    (async () => {
      try {
        const s = await window.desktopAPI?.getOfflineResourcesStatus?.();
        if (!cancelled && s) {
          setOfflineStatus({ installed: s.installed, url: s.url, baseDir: s.baseDir });
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    void refreshOfflineStatus();
  }, [refreshOfflineStatus]);

  React.useEffect(() => {
    const api = window.desktopAPI;
    if (!api?.onOfflinePackUpdateStatus) return;
    const unsub = api.onOfflinePackUpdateStatus((payload) => {
      if (payload && typeof payload === 'object' && typeof payload.status === 'string') {
        setOfflineUpdateStatus(payload);
      }
    });
    return () => {
      try {
        unsub?.();
      } catch {
        // ignore
      }
    };
  }, []);

  const handlePick = useCallback(async () => {
    setPickError(null);
    try {
      const api = window.desktopAPI;
      if (!api?.pickPdfFiles) {
        throw new Error('Desktop file picker is unavailable.');
      }
      const files = await api.pickPdfFiles();
      setSelectedFiles(files);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to pick files.';
      setPickError(msg);
    }
  }, []);

  const handleInstallOffline = useCallback(async () => {
    setOfflineInstallError(null);
    setIsInstallingOffline(true);
    try {
      const api = window.desktopAPI;
      if (!api?.installOfflineResources) {
        throw new Error('Offline installer is unavailable.');
      }
      const result = await api.installOfflineResources();
      setOfflineStatus({ installed: result.installed, url: result.url, baseDir: result.baseDir });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to install offline resources.';
      setOfflineInstallError(msg);
    } finally {
      setIsInstallingOffline(false);
    }
  }, []);

  const handleInstallOfflineFromZip = useCallback(async () => {
    setOfflineInstallError(null);
    setIsInstallingFromZip(true);
    try {
      const api = window.desktopAPI;
      if (!api?.pickOfflinePackZip || !api?.installOfflineResourcesFromZip) {
        throw new Error('Offline ZIP installer is unavailable.');
      }
      const zipPath = await api.pickOfflinePackZip();
      if (!zipPath) {
        return;
      }
      const result = await api.installOfflineResourcesFromZip(zipPath);
      setOfflineStatus({ installed: result.installed, url: result.url, baseDir: result.baseDir });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to install offline resources from zip.';
      setOfflineInstallError(msg);
    } finally {
      setIsInstallingFromZip(false);
    }
  }, []);

  const handleCheckOfflinePackUpdates = useCallback(async () => {
    setOfflineInstallError(null);
    setIsCheckingOfflineUpdate(true);
    try {
      const api = window.desktopAPI;
      if (!api?.checkOfflinePackUpdates) {
        throw new Error('Offline pack updater is unavailable.');
      }
      const res = await api.checkOfflinePackUpdates();
      if (!res?.ok) {
        throw new Error(res?.message || 'Failed to check offline pack updates.');
      }
      setOfflineUpdateInfo({
        installedVersion: res.installedVersion ?? null,
        remoteVersion: res.remoteVersion ?? null,
        updateAvailable: !!res.updateAvailable
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to check offline pack updates.';
      setOfflineInstallError(msg);
    } finally {
      setIsCheckingOfflineUpdate(false);
    }
  }, []);

  const handleUpdateOfflinePack = useCallback(async () => {
    setOfflineInstallError(null);
    setIsUpdatingOfflinePack(true);
    try {
      const api = window.desktopAPI;
      if (!api?.installOfflinePackUpdate) {
        throw new Error('Offline pack updater is unavailable.');
      }
      const res = await api.installOfflinePackUpdate();
      if (!res?.ok) {
        throw new Error(res?.message || 'Failed to update offline pack.');
      }
      await refreshOfflineStatus();
      await handleCheckOfflinePackUpdates();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to update offline pack.';
      setOfflineInstallError(msg);
    } finally {
      setIsUpdatingOfflinePack(false);
    }
  }, [refreshOfflineStatus, handleCheckOfflinePackUpdates]);

  const handleAnalyzeClick = () => {
    if (selectedFiles.length > 0) {
      onAnalyzePaths(selectedFiles);
    }
  };

  const handleRemoveFile = (indexToRemove: number) => {
    setSelectedFiles((prev) => prev.filter((_, index) => index !== indexToRemove));
  };

  return (
    <div className="w-full max-w-2xl mx-auto p-6 bg-brand-light border border-brand-border rounded-lg shadow-lg">
      <div className="space-y-3">
        <p className="text-sm text-brand-gray">
          Desktop mode: pick PDFs from your computer.
        </p>

        {offlineStatus && !offlineStatus.installed && (
          <div className="p-3 rounded-md border border-yellow-500/30 bg-yellow-500/10 text-sm text-yellow-200 space-y-2">
            <div>
              Offline analysis isn’t installed yet. Download the offline pack (~3–4GB) to enable offline analysis.
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={handleInstallOffline}
                disabled={isLoading || isInstallingOffline || isInstallingFromZip}
                className="bg-yellow-600 text-black font-semibold py-2 px-4 rounded-md hover:bg-yellow-500 transition-all duration-300 disabled:bg-gray-500 disabled:cursor-not-allowed"
              >
                {isInstallingOffline ? 'Downloading…' : 'Download Offline Pack'}
              </button>
              <button
                type="button"
                onClick={handleInstallOfflineFromZip}
                disabled={isLoading || isInstallingOffline || isInstallingFromZip}
                className="bg-gray-700 text-white font-semibold py-2 px-4 rounded-md hover:bg-gray-600 transition-all duration-300 disabled:bg-gray-500 disabled:cursor-not-allowed"
              >
                {isInstallingFromZip ? 'Installing…' : 'Install from ZIP'}
              </button>
              <button
                type="button"
                onClick={() => window.desktopAPI?.openExternal?.(offlineStatus.url)}
                disabled={isLoading || isInstallingOffline || isInstallingFromZip}
                className="bg-gray-700 text-white font-semibold py-2 px-4 rounded-md hover:bg-gray-600 transition-all duration-300 disabled:bg-gray-500 disabled:cursor-not-allowed"
              >
                Open Download Link
              </button>
              <button
                type="button"
                onClick={refreshOfflineStatus}
                disabled={isLoading || isInstallingOffline || isInstallingFromZip}
                className="bg-gray-800 text-white font-semibold py-2 px-4 rounded-md hover:bg-gray-700 transition-all duration-300 disabled:bg-gray-500 disabled:cursor-not-allowed"
              >
                Refresh
              </button>
            </div>
            {offlineInstallError && (
              <div className="text-red-200">
                {offlineInstallError}
              </div>
            )}
          </div>
        )}

        {offlineStatus && offlineStatus.installed && (
          <div className="p-3 rounded-md border border-green-500/30 bg-green-500/10 text-sm text-green-200 space-y-2">
            <div>
              Offline analysis is installed.
              {offlineStatus.baseDir ? (
                <span className="text-green-100/80"> Installed at: {offlineStatus.baseDir}</span>
              ) : null}
            </div>
            <div className="text-green-100/80">
              Offline pack updates:
              {offlineUpdateInfo?.installedVersion ? (
                <span> current {offlineUpdateInfo.installedVersion}</span>
              ) : (
                <span> current (unknown)</span>
              )}
              {offlineUpdateInfo?.remoteVersion ? (
                <span>, latest {offlineUpdateInfo.remoteVersion}</span>
              ) : null}
              {offlineUpdateInfo?.updateAvailable ? <span className="text-yellow-200"> (update available)</span> : null}
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={handleInstallOfflineFromZip}
                disabled={isLoading || isInstallingOffline || isInstallingFromZip}
                className="bg-gray-700 text-white font-semibold py-2 px-4 rounded-md hover:bg-gray-600 transition-all duration-300 disabled:bg-gray-500 disabled:cursor-not-allowed"
              >
                {isInstallingFromZip ? 'Installing…' : 'Reinstall from ZIP'}
              </button>
              <button
                type="button"
                onClick={handleCheckOfflinePackUpdates}
                disabled={isLoading || isInstallingOffline || isInstallingFromZip || isCheckingOfflineUpdate || isUpdatingOfflinePack}
                className="bg-gray-700 text-white font-semibold py-2 px-4 rounded-md hover:bg-gray-600 transition-all duration-300 disabled:bg-gray-500 disabled:cursor-not-allowed"
              >
                {isCheckingOfflineUpdate ? 'Checking…' : 'Check Offline Pack Updates'}
              </button>
              <button
                type="button"
                onClick={handleUpdateOfflinePack}
                disabled={isLoading || isInstallingOffline || isInstallingFromZip || isUpdatingOfflinePack || !offlineUpdateInfo?.updateAvailable}
                className="bg-yellow-600 text-black font-semibold py-2 px-4 rounded-md hover:bg-yellow-500 transition-all duration-300 disabled:bg-gray-500 disabled:cursor-not-allowed"
              >
                {isUpdatingOfflinePack ? 'Updating…' : 'Update Offline Pack'}
              </button>
              <button
                type="button"
                onClick={refreshOfflineStatus}
                disabled={isLoading || isInstallingOffline || isInstallingFromZip}
                className="bg-gray-800 text-white font-semibold py-2 px-4 rounded-md hover:bg-gray-700 transition-all duration-300 disabled:bg-gray-500 disabled:cursor-not-allowed"
              >
                Refresh
              </button>
            </div>
            {offlineUpdateStatus?.status ? (
              <div className="text-xs text-green-100/80">
                {offlineUpdateStatus.status === 'downloading'
                  ? `Updating: downloading ${offlineUpdateStatus.component || ''} ${typeof offlineUpdateStatus.percent === 'number' ? `${offlineUpdateStatus.percent.toFixed(0)}%` : ''}`
                  : offlineUpdateStatus.status === 'extracting'
                    ? `Updating: installing ${offlineUpdateStatus.component || ''}`
                    : offlineUpdateStatus.status === 'done'
                      ? 'Offline pack update complete.'
                      : offlineUpdateStatus.status === 'error'
                        ? `Offline pack update error: ${offlineUpdateStatus.message || 'Unknown'}`
                        : `Offline pack update: ${offlineUpdateStatus.status}`}
              </div>
            ) : null}
          </div>
        )}

        <button
          type="button"
          onClick={handlePick}
          disabled={isLoading || isInstallingOffline}
          className="w-full bg-gray-700 text-white font-semibold py-3 px-4 rounded-md hover:bg-gray-600 transition-all duration-300 disabled:bg-gray-500 disabled:cursor-not-allowed"
        >
          Select PDF Document(s)
        </button>

        {pickError && (
          <div className="p-3 rounded-md border border-red-500/30 bg-red-500/10 text-sm text-red-300">
            {pickError}
          </div>
        )}
      </div>

      {selectedFiles.length > 0 && (
        <div className="mt-6 space-y-2">
          <h3 className="text-sm font-semibold text-brand-gray">Selected Files:</h3>
          <ul className="max-h-40 overflow-y-auto space-y-2 rounded-md border border-brand-border p-2 bg-gray-800/50">
            {selectedFiles.map((file, index) => (
              <li key={file.path} className="flex items-center justify-between bg-brand-dark p-2 rounded">
                <div className="flex items-center space-x-2 truncate">
                  <DocumentIcon className="w-5 h-5 text-brand-blue flex-shrink-0" />
                  <span className="text-sm truncate" title={file.name}>
                    {file.name}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveFile(index)}
                  className="p-1 rounded-full hover:bg-gray-700 transition-colors"
                  aria-label={`Remove ${file.name}`}
                >
                  <XIcon className="w-4 h-4 text-brand-gray" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        onClick={handleAnalyzeClick}
        disabled={selectedFiles.length === 0 || isLoading || isInstallingOffline}
        className="mt-6 w-full bg-brand-blue text-white font-bold py-3 px-4 rounded-md hover:bg-blue-600 transition-all duration-300 disabled:bg-gray-500 disabled:cursor-not-allowed flex items-center justify-center"
      >
        {isLoading ? 'Analyzing...' : `Analyze ${selectedFiles.length} Document(s)`}
      </button>

      {(isLoading || (analysisElapsedMs != null && !isLoading)) ? (
        <div className="mt-3 text-center text-sm text-brand-gray space-y-2">
          <div>
            {isLoading ? 'Elapsed:' : 'Completed in:'}{' '}
            <span className="text-white">
              {(() => {
                const ms = Math.max(0, analysisElapsedMs || 0);
                const totalSec = Math.floor(ms / 1000);
                const m = Math.floor(totalSec / 60);
                const s = totalSec % 60;
                return `${m}:${String(s).padStart(2, '0')}`;
              })()}
            </span>
          </div>
          {isLoading ? (
            <div className="w-full">
              <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-2 bg-brand-blue transition-all duration-300"
                  style={{ width: `${Math.max(0, Math.min(100, analysisProgress ?? 0))}%` }}
                />
              </div>
              <div className="mt-1 text-xs text-brand-gray/80">
                {analysisStage ? `Status: ${analysisStage}` : 'Status: working…'}
                {typeof analysisProgress === 'number' ? ` (${analysisProgress.toFixed(0)}%)` : ''}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};


