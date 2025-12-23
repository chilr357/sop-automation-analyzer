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
  const [offlineStatus, setOfflineStatus] = useState<{ installed: boolean; url: string; baseDir?: string; ocrAvailable?: boolean } | null>(null);
  const [offlineInstallError, setOfflineInstallError] = useState<string | null>(null);
  const [isInstallingOffline, setIsInstallingOffline] = useState(false);
  const [isInstallingFromZip, setIsInstallingFromZip] = useState(false);
  const [offlineUpdateInfo, setOfflineUpdateInfo] = useState<{
    checked: boolean;
    localVersion: string | null;
    remoteVersion: string | null;
    updateAvailable: boolean;
    message?: string;
  }>({ checked: false, localVersion: null, remoteVersion: null, updateAvailable: false });
  const [offlineUpdateStatus, setOfflineUpdateStatus] = useState<{ status: string; percent?: number; filePath?: string } | null>(null);
  const [isUpdatingOffline, setIsUpdatingOffline] = useState(false);

  const refreshOfflineStatus = useCallback(async () => {
    let cancelled = false;
    (async () => {
      try {
        const s = await window.desktopAPI?.getOfflineResourcesStatus?.();
        if (!cancelled && s) {
          setOfflineStatus({ installed: s.installed, url: s.url, baseDir: s.baseDir, ocrAvailable: (s as any).ocrAvailable });
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
    const unsub = api.onOfflinePackUpdateStatus((payload: any) => {
      if (payload?.status) {
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

  const handleCheckOfflineUpdates = useCallback(async () => {
    setOfflineUpdateInfo((p) => ({ ...p, checked: true, message: undefined }));
    try {
      const api = window.desktopAPI;
      if (!api?.checkOfflinePackUpdates) {
        setOfflineUpdateInfo({
          checked: true,
          localVersion: null,
          remoteVersion: null,
          updateAvailable: false,
          message: 'Offline pack updater is unavailable.'
        });
        return;
      }
      const res = await api.checkOfflinePackUpdates();
      setOfflineUpdateInfo({
        checked: true,
        localVersion: res.localVersion,
        remoteVersion: res.remoteVersion,
        updateAvailable: !!res.updateAvailable,
        message: res.updateAvailable ? 'Update available.' : 'Offline pack is up to date.'
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to check offline pack updates.';
      setOfflineUpdateInfo({ checked: true, localVersion: null, remoteVersion: null, updateAvailable: false, message: msg });
    }
  }, []);

  const handleApplyOfflineUpdate = useCallback(async () => {
    setOfflineInstallError(null);
    setIsUpdatingOffline(true);
    try {
      const api = window.desktopAPI;
      if (!api?.applyOfflinePackUpdate) {
        throw new Error('Offline pack updater is unavailable.');
      }
      await api.applyOfflinePackUpdate();
      await refreshOfflineStatus();
      await handleCheckOfflineUpdates();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to update offline pack.';
      setOfflineInstallError(msg);
    } finally {
      setIsUpdatingOffline(false);
    }
  }, [handleCheckOfflineUpdates, refreshOfflineStatus]);

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
              {offlineStatus.ocrAvailable ? (
                <span className="text-green-100/80"> • OCR: available</span>
              ) : (
                <span className="text-green-100/60"> • OCR: not included</span>
              )}
            </div>
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
                onClick={handleCheckOfflineUpdates}
                disabled={isLoading || isInstallingOffline || isInstallingFromZip || isUpdatingOffline}
                className="bg-gray-700 text-white font-semibold py-2 px-4 rounded-md hover:bg-gray-600 transition-all duration-300 disabled:bg-gray-500 disabled:cursor-not-allowed"
              >
                Check Offline Pack Updates
              </button>
              <button
                type="button"
                onClick={handleApplyOfflineUpdate}
                disabled={isLoading || isInstallingOffline || isInstallingFromZip || isUpdatingOffline || !offlineUpdateInfo.updateAvailable}
                className="bg-yellow-600 text-black font-semibold py-2 px-4 rounded-md hover:bg-yellow-500 transition-all duration-300 disabled:bg-gray-500 disabled:cursor-not-allowed"
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
            {offlineUpdateInfo.checked ? (
              <div className="text-green-100/80">
                Offline pack version: {offlineUpdateInfo.localVersion || 'unknown'} → {offlineUpdateInfo.remoteVersion || 'unknown'}{' '}
                {offlineUpdateInfo.message ? `(${offlineUpdateInfo.message})` : ''}
              </div>
            ) : null}
            {offlineUpdateStatus?.status === 'downloading' && typeof offlineUpdateStatus.percent === 'number' ? (
              <div className="text-green-100/80">
                Updating offline pack… {offlineUpdateStatus.percent}%{offlineUpdateStatus.filePath ? ` (${offlineUpdateStatus.filePath})` : ''}
              </div>
            ) : null}
            {offlineInstallError && (
              <div className="text-red-200">
                {offlineInstallError}
              </div>
            )}
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


