import React from "react";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Play, Pause, X, Trash2, Folder, 
  ExternalLink, Youtube, Download, 
  Zap, Globe, MonitorPlay, Layers, Copy,
  CheckCircle2, AlertCircle, Clock
} from "lucide-react";
import { 
  ContextMenu, 
  ContextMenuContent, 
  ContextMenuItem, 
  ContextMenuTrigger,
  ContextMenuSeparator
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";

interface DownloadCardProps {
  task: any;
  onCancel: (id: number) => void;
  onDelete: (task: any) => void;
  onOpenFolder: (path: string) => void;
  onOpenFile: (path: string) => void;
}

const getEngineIcon = (engine: string) => {
  switch (engine) {
    case 'yt-dlp': return <Youtube className="w-4 h-4" />;
    case 'aria2c': return <Layers className="w-4 h-4" />;
    case 'surge': return <Zap className="w-4 h-4" />;
    default: return <Download className="w-4 h-4" />;
  }
};

const getStatusColor = (status: string) => {
  switch (status) {
    case 'downloading': return 'bg-primary/20 text-primary border-primary/30';
    case 'completed': return 'bg-green-500/20 text-green-400 border-green-500/30';
    case 'error': return 'bg-destructive/20 text-destructive border-destructive/30';
    case 'pending': return 'bg-yellow-500/20 text-yellow-500 border-yellow-500/30 animate-pulse';
    default: return 'bg-secondary text-secondary-foreground';
  }
};

export function DownloadCard({ task, onCancel, onDelete, onOpenFolder, onOpenFile }: DownloadCardProps) {
  const isDownloading = task.status === 'downloading';
  const isCompleted = task.status === 'completed';
  const isError = task.status === 'error';

  const handleCopyLink = () => {
    navigator.clipboard.writeText(task.url);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <div className={cn(
          "group relative bg-white/5 border border-white/5 rounded-xl p-4 transition-all duration-300 hover:bg-white/10 hover:border-white/10 overflow-hidden cursor-default select-none",
          isDownloading && "border-primary/20 bg-primary/5"
        )}>
          {isDownloading && (
            <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-transparent opacity-50" />
          )}
          
          <div className="flex items-start gap-4 relative z-10">
            <div className={cn(
              "w-12 h-12 rounded-lg flex items-center justify-center border transition-all duration-300",
              isDownloading ? "bg-primary/20 border-primary/30 text-primary" : "bg-white/5 border-white/10 text-white/40"
            )}>
              {getEngineIcon(task.engine)}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-semibold truncate text-sm flex gap-2 items-center">
                  {task.filename}
                </h3>
                <Badge variant="outline" className={cn("text-[10px] uppercase font-bold tracking-widest px-2 py-0", getStatusColor(task.status))}>
                  {task.status}
                </Badge>
              </div>
              
              <p className="text-[10px] text-white/40 mb-3 truncate font-mono">
                {task.url}
              </p>

              <div className="space-y-1.5">
                <div className="flex justify-between text-[10px] font-mono mb-1">
                  <span className="text-white/60">{Math.min(100, Math.max(0, Math.round(task.percentage)))}%</span>
                  {isDownloading && <span className="text-primary">{task.speed}</span>}
                </div>
                <Progress value={Math.min(100, task.percentage)} className="h-1" />
              </div>
            </div>

            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {isDownloading ? (
                <Button size="icon" variant="ghost" className="w-8 h-8 rounded-full hover:bg-destructive/20 hover:text-destructive" onClick={() => onCancel(task.id)}>
                  <X className="w-4 h-4" />
                </Button>
              ) : (
                <>
                  {isCompleted ? (
                    <Button size="icon" variant="ghost" className="w-8 h-8 rounded-full hover:bg-white/10" onClick={() => onOpenFile(task.savePath)}>
                      <ExternalLink className="w-4 h-4" />
                    </Button>
                  ) : (
                    <Button size="icon" variant="ghost" className="w-8 h-8 rounded-full hover:bg-white/10 text-destructive" onClick={() => onDelete(task)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </>
              )}
              <Button size="icon" variant="ghost" className="w-8 h-8 rounded-full hover:bg-white/10" onClick={() => onOpenFolder(task.savePath)}>
                <Folder className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </ContextMenuTrigger>
      
      <ContextMenuContent className="w-56 bg-slate-900/95 backdrop-blur-xl border-white/10 text-white/80 shadow-2xl">
        <ContextMenuItem className="gap-2 focus:bg-primary/20 focus:text-primary" onClick={() => isCompleted ? onOpenFile(task.savePath) : undefined} disabled={!isCompleted}>
          <ExternalLink className="w-4 h-4" /> Play/Open File
        </ContextMenuItem>
        <ContextMenuItem className="gap-2 focus:bg-white/10" onClick={() => onOpenFolder(task.savePath)}>
          <Folder className="w-4 h-4" /> Open Folder
        </ContextMenuItem>
        
        <ContextMenuSeparator className="bg-white/5" />
        
        {isDownloading ? (
          <ContextMenuItem className="gap-2 focus:bg-white/10" onClick={() => onCancel(task.id)}>
            <Pause className="w-4 h-4" /> Pause Download
          </ContextMenuItem>
        ) : (
          <ContextMenuItem className="gap-2 focus:bg-white/10" disabled>
            <Play className="w-4 h-4" /> Resume Download
          </ContextMenuItem>
        )}
        
        <ContextMenuSeparator className="bg-white/5" />
        
        <ContextMenuItem className="gap-2 focus:bg-white/10" onClick={handleCopyLink}>
          <Copy className="w-4 h-4" /> Copy URL
        </ContextMenuItem>
        
        <ContextMenuSeparator className="bg-white/5" />
        
        <ContextMenuItem className="gap-2 focus:bg-destructive/20 focus:text-destructive text-destructive/80" onClick={() => onDelete(task)}>
          <Trash2 className="w-4 h-4" /> Delete Transfer
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
