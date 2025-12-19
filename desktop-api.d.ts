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
      pathToFileUrl: (filePath: string) => Promise<string | null>;

      // Auto-updater
      checkForUpdates: () => Promise<{ ok: boolean; message?: string; result?: unknown }>;
      quitAndInstallUpdate: () => Promise<{ ok: boolean; message?: string }>;

      // Offline pack installer (downloads from Supabase public URL and installs into userData)
      getOfflineResourcesStatus: () => Promise<{ installed: boolean; missing: string[]; baseDir: string; url: string }>;
      installOfflineResources: () => Promise<{ installed: boolean; missing: string[]; baseDir: string; url: string }>;

      // Offline pack local install (user already downloaded the zip)
      pickOfflinePackZip: () => Promise<string | null>;
      installOfflineResourcesFromZip: (
        zipPath: string
      ) => Promise<{ installed: boolean; missing: string[]; baseDir: string; url: string }>;
    };
  }
}


