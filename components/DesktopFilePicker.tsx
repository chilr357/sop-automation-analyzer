import React, { useCallback, useState } from 'react';
import { DocumentIcon, XIcon } from './IconComponents';

export type DesktopPickedFile = { path: string; name: string; url: string };

interface DesktopFilePickerProps {
  isLoading: boolean;
  onAnalyzePaths: (files: DesktopPickedFile[]) => void;
}

export const DesktopFilePicker: React.FC<DesktopFilePickerProps> = ({ isLoading, onAnalyzePaths }) => {
  const [selectedFiles, setSelectedFiles] = useState<DesktopPickedFile[]>([]);
  const [pickError, setPickError] = useState<string | null>(null);
  const [offlineStatus, setOfflineStatus] = useState<{ installed: boolean; url: string; baseDir?: string } | null>(null);
  const [offlineInstallError, setOfflineInstallError] = useState<string | null>(null);
  const [isInstallingOffline, setIsInstallingOffline] = useState(false);
  const [isInstallingFromZip, setIsInstallingFromZip] = useState(false);
  const [offlineUpdateInfo, setOfflineUpdateInfo] = useState<{ installedVersion?: string | null; latestVersion?: string | null; needsUpdate?: boolean; message?: string } | null>(null);
  const [offlineUpdateStatus, setOfflineUpdateStatus] = useState<{ status: string; percent?: number; component?: string; message?: string } | null>(null);
  const [isUpdatingOffline, setIsUpdatingOffline] = useState(false);
  const [ocrTools, setOcrTools] = useState<{ available: boolean; installUrl: string } | null>(null);

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
    let cancelled = false;
    (async () => {
      try {
        const res = await window.desktopAPI?.getOcrToolsStatus?.();
        if (cancelled) return;
        if (res?.ok && typeof res.available === 'boolean' && typeof res.installUrl === 'string') {
          setOcrTools({ available: res.available, installUrl: res.installUrl });
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
    const api = window.desktopAPI;
    if (!api?.onOfflineUpdateStatus) return;
    const unsubscribe = api.onOfflineUpdateStatus((payload) => {
      if (payload && typeof payload === 'object' && typeof payload.status === 'string') {
        setOfflineUpdateStatus(payload);
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

  const handleCheckOfflineUpdate = useCallback(async () => {
    setOfflineInstallError(null);
    setOfflineUpdateInfo(null);
    try {
      const api = window.desktopAPI;
      if (!api?.checkOfflinePackUpdate) {
        throw new Error('Offline pack updater is unavailable.');
      }
      const res = await api.checkOfflinePackUpdate();
      setOfflineUpdateInfo({
        installedVersion: res.installedVersion ?? null,
        latestVersion: res.latestVersion ?? null,
        needsUpdate: !!res.needsUpdate,
        message: res.message
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to check offline pack update.';
      setOfflineInstallError(msg);
    }
  }, []);

  const handleUpdateOfflinePack = useCallback(async () => {
    setOfflineInstallError(null);
    setIsUpdatingOffline(true);
    try {
      const api = window.desktopAPI;
      if (!api?.updateOfflinePack) {
        throw new Error('Offline pack updater is unavailable.');
      }
      await api.updateOfflinePack();
      await refreshOfflineStatus();
      await handleCheckOfflineUpdate();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to update offline pack.';
      setOfflineInstallError(msg);
    } finally {
      setIsUpdatingOffline(false);
    }
  }, [handleCheckOfflineUpdate, refreshOfflineStatus]);

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
            {ocrTools && !ocrTools.available ? (
              <div className="text-green-100/80">
                OCR tools: <span className="text-yellow-200">not installed</span>. Scanned/image PDFs may fail in Offline mode.
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => window.desktopAPI?.openExternal?.(ocrTools.installUrl)}
                    disabled={isLoading}
                    className="bg-gray-700 text-white font-semibold py-2 px-4 rounded-md hover:bg-gray-600 transition-all duration-300 disabled:bg-gray-500 disabled:cursor-not-allowed"
                  >
                    Install OCR Tools
                  </button>
                </div>
              </div>
            ) : null}
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={handleInstallOfflineFromZip}
                disabled={isLoading || isInstallingOffline || isInstallingFromZip || isUpdatingOffline}
                className="bg-gray-700 text-white font-semibold py-2 px-4 rounded-md hover:bg-gray-600 transition-all duration-300 disabled:bg-gray-500 disabled:cursor-not-allowed"
              >
                {isInstallingFromZip ? 'Installing…' : 'Reinstall from ZIP'}
              </button>
              <button
                type="button"
                onClick={handleCheckOfflineUpdate}
                disabled={isLoading || isInstallingOffline || isInstallingFromZip || isUpdatingOffline}
                className="bg-gray-700 text-white font-semibold py-2 px-4 rounded-md hover:bg-gray-600 transition-all duration-300 disabled:bg-gray-500 disabled:cursor-not-allowed"
              >
                Check Offline Pack Update
              </button>
              <button
                type="button"
                onClick={handleUpdateOfflinePack}
                disabled={isLoading || isInstallingOffline || isInstallingFromZip || isUpdatingOffline || offlineUpdateInfo?.needsUpdate === false}
                className="bg-green-600 text-black font-semibold py-2 px-4 rounded-md hover:bg-green-500 transition-all duration-300 disabled:bg-gray-500 disabled:cursor-not-allowed"
              >
                {isUpdatingOffline ? 'Updating…' : 'Update Offline Pack'}
              </button>
              <button
                type="button"
                onClick={refreshOfflineStatus}
                disabled={isLoading || isInstallingOffline || isInstallingFromZip || isUpdatingOffline}
                className="bg-gray-800 text-white font-semibold py-2 px-4 rounded-md hover:bg-gray-700 transition-all duration-300 disabled:bg-gray-500 disabled:cursor-not-allowed"
              >
                Refresh
              </button>
            </div>
            {offlineUpdateInfo ? (
              <div className="text-green-100/80">
                Installed pack: {offlineUpdateInfo.installedVersion || 'unknown'} · Latest: {offlineUpdateInfo.latestVersion || 'unknown'}
                {offlineUpdateInfo.needsUpdate === false ? ' · Up to date' : ''}
                {offlineUpdateInfo.message ? <div>{offlineUpdateInfo.message}</div> : null}
              </div>
            ) : null}
            {offlineUpdateStatus?.status === 'downloading' || offlineUpdateStatus?.status === 'installing' ? (
              <div className="text-green-100/80">
                {offlineUpdateStatus.message || `${offlineUpdateStatus.status}…`}
                {typeof offlineUpdateStatus.percent === 'number' ? (
                  <div className="mt-2 w-full bg-black/30 rounded h-2 overflow-hidden">
                    <div
                      className="h-2 bg-green-400"
                      style={{ width: `${Math.max(0, Math.min(100, offlineUpdateStatus.percent))}%` }}
                    />
                  </div>
                ) : null}
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
    </div>
  );
};


