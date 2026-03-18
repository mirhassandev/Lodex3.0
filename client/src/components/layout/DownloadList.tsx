import React, { useState, useEffect } from "react";
import { DownloadCard } from "./DownloadCard";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileType } from "@/lib/mock-data";
import { Search, Filter, ArrowUpDown, MoreHorizontal, LayoutGrid, List, Download } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface DownloadListProps {
  activeFilter: string;
  searchQuery: string;
  tasks: any[];
  onTaskUpdate: () => void;
  onDeleteTask: (task: any) => void;
}

export function DownloadList({ activeFilter, searchQuery, tasks, onTaskUpdate, onDeleteTask }: DownloadListProps) {
  const [loading, setLoading] = useState(false);

  // Filter tasks
  const filteredTasks = tasks.filter(task => {
    if (activeFilter === "all") return true;

    const ext = task.filename.split('.').pop()?.toLowerCase();
    const videoExts = ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv'];
    const audioExts = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg'];
    const archiveExts = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2'];
    const documentExts = ['pdf', 'doc', 'docx', 'txt', 'rtf', 'xls', 'xlsx', 'ppt', 'pptx'];
    const programExts = ['exe', 'msi', 'bat', 'cmd', 'sh', 'app', 'dmg'];

    if (activeFilter === "video") return videoExts.includes(ext || '') || task.engine === 'yt-dlp';
    if (activeFilter === "audio") return audioExts.includes(ext || '');
    if (activeFilter === "archive") return archiveExts.includes(ext || '');
    if (activeFilter === "document") return documentExts.includes(ext || '');
    if (activeFilter === "program") return programExts.includes(ext || '');

    if (activeFilter.startsWith("queue-")) {
      const qId = parseInt(activeFilter.replace("queue-", ""));
      const taskQId = task.queue_id || 1; // SQLite uses underscore usually from drizzle
      return taskQId === qId;
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchesSearch = 
        task.filename.toLowerCase().includes(query) || 
        task.url.toLowerCase().includes(query);
      if (!matchesSearch) return false;
    }

    return true;
  });

  const handleCancel = async (id: number) => {
    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.cancelDownload) {
      await electronAPI.cancelDownload(id);
      onTaskUpdate();
    }
  };

  const handleDelete = async (task: any) => {
    onDeleteTask(task);
  };

  const handleOpenFolder = async (path: string) => {
    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.openFolder) await electronAPI.openFolder(path);
  };

  const handleOpenFile = async (path: string) => {
    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.openFile) await electronAPI.openFile(path);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background/40 backdrop-blur-sm border-t border-white/5">

      <ScrollArea className="flex-1 px-4 py-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-4 max-w-[1600px] mx-auto">
          {filteredTasks.length > 0 ? (
            filteredTasks.map((task) => (
              <DownloadCard
                key={task.id}
                task={task}
                onCancel={handleCancel}
                onDelete={handleDelete}
                onOpenFolder={handleOpenFolder}
                onOpenFile={handleOpenFile}
              />
            ))
          ) : (
            <div className="col-span-full py-20 text-center">
              <div className="w-20 h-20 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-6 opacity-20">
                <Download className="w-10 h-10 text-white" />
              </div>
              <p className="text-white/20 font-medium uppercase tracking-widest text-xs">No downloads found in this category</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
