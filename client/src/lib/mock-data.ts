import { Video, Music, FileText, Archive, Play, Pause, X, RotateCw, MonitorPlay, FolderOpen } from "lucide-react";

export type DownloadStatus = "downloading" | "paused" | "error" | "completed" | "queued" | "scheduled" | "retrying";
export type FileType = "video" | "audio" | "document" | "archive" | "other";

export interface DownloadItem {
  id: string;
  name: string;
  size: string; // e.g., "1.2 GB"
  totalBytes: number;
  downloadedBytes: number;
  progress: number; // 0-100
  speed: string; // e.g., "2.4 MB/s"
  status: DownloadStatus;
  priority: "high" | "normal" | "low";
  type: FileType;
  url: string;
  eta: string;
  dateAdded: string;
  retryCount?: number;
  scheduledAt?: number;
  outPath?: string;
  connections?: number;
  segmentsDone?: number;
  segmentsTotal?: number;
  merging?: boolean;
}

export const mockDownloads: DownloadItem[] = [];

export const getIconForType = (type: FileType) => {
  switch (type) {
    case "video": return MonitorPlay;
    case "audio": return Music;
    case "document": return FileText;
    case "archive": return Archive;
    default: return FileText;
  }
};
export const getFileType = (filename: string): FileType => {
  const ext = filename.split('.').pop()?.toLowerCase();

  const videoExtensions = ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv'];
  const audioExtensions = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'];
  const archiveExtensions = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'];
  const documentExtensions = ['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'md'];

  if (videoExtensions.includes(ext!)) return 'video';
  if (audioExtensions.includes(ext!)) return 'audio';
  if (archiveExtensions.includes(ext!)) return 'archive';
  if (documentExtensions.includes(ext!)) return 'document';

  return 'other';
};
