import { downloadBlob } from "../../pdf/pdfGenerator";

type DownloadsNamespace = {
  save(request: { filename: string; data: Blob }): Promise<{ status: "saved" | "delivered" }>;
};

type HostBridge = { use?: (name: string) => Promise<unknown> };

let downloadsPromise: Promise<DownloadsNamespace | null> | undefined;

/**
 * When the app runs inside a claude.ai artifact viewer, direct downloads are blocked and
 * files go through the viewer's save prompt. Everywhere else this is a normal browser download.
 */
function getHostDownloads(): Promise<DownloadsNamespace | null> {
  if (!downloadsPromise) {
    const host = (globalThis as { claude?: HostBridge }).claude;
    downloadsPromise = host?.use
      ? host.use("downloads").then((namespace) => (namespace as DownloadsNamespace | null) ?? null).catch(() => null)
      : Promise.resolve(null);
  }
  return downloadsPromise;
}

/** Start the host lookup early so the first export click is not delayed. */
export function prepareFileSaving() {
  void getHostDownloads();
}

export async function saveFile(blob: Blob, fileName: string): Promise<"saved" | "declined"> {
  const downloads = await getHostDownloads();
  if (!downloads) {
    downloadBlob(blob, fileName);
    return "saved";
  }
  try {
    await downloads.save({ filename: fileName, data: blob });
    return "saved";
  } catch (error) {
    if ((error as { code?: string })?.code === "declined") return "declined";
    throw new Error((error as { message?: string })?.message ?? "The file could not be saved.");
  }
}
