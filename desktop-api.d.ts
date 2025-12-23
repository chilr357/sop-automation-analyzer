import type { AnalysisReport } from './types';

export {};

declare global {
  interface Window {
    desktopAPI?: {
      getAppInfo: () => Promise<{ name: string; version: string }>;
      getStartUrl: () => Promise<string>;
      openExternal: (url: string) => void;

      // Offline desktop additions
      pickPdfFiles: () => Promise<Array<{ path: string; name: string; url: string }>>;
      analyzePdfPaths: (
        filePaths: string[]
      ) => Promise<Array<{ ok: true; filePath: string; report: AnalysisReport } | { ok: false; filePath: string; error: string }>>;
      onAnalysisStatus: (callback: (payload: any) => void) => () => void;
      pathToFileUrl: (filePath: string) => Promise<string | null>;

      // Auto-updater
      checkForUpdates: () => Promise<{ ok: boolean; message?: string; result?: unknown }>;
      quitAndInstallUpdate: () => Promise<{ ok: boolean; message?: string }>;
      onUpdateStatus: (callback: (payload: { status: string; percent?: number; bytesPerSecond?: number; message?: string }) => void) => () => void;

      // Offline pack installer (downloads from Supabase public URL and installs into userData)
      getOfflineResourcesStatus: () => Promise<{ installed: boolean; missing: string[]; baseDir: string; url: string; ocrAvailable?: boolean }>;
      installOfflineResources: () => Promise<{ installed: boolean; missing: string[]; baseDir: string; url: string; ocrAvailable?: boolean }>;
      checkOfflinePackUpdates: () => Promise<{
        ok: boolean;
        baseDir: string;
        manifestUrl: string;
        localVersion: string | null;
        remoteVersion: string;
        updateAvailable: boolean;
        filesToUpdate: Array<{ path: string; size: number | null }>;
      }>;
      applyOfflinePackUpdate: () => Promise<{ ok: boolean; baseDir: string; version: string }>;
      onOfflinePackUpdateStatus: (callback: (payload: any) => void) => () => void;

      // Offline pack local install (user already downloaded the zip)
      pickOfflinePackZip: () => Promise<string | null>;
      installOfflineResourcesFromZip: (
        zipPath: string
      ) => Promise<{ installed: boolean; missing: string[]; baseDir: string; url: string; ocrAvailable?: boolean }>;
    };
  }
}


