import React from "react";
import { DownloadItem, getIconForType, FileType } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { MoreHorizontal, FolderOpen, Play, Pause, RefreshCw, X, MoreVertical, ArrowUp, ArrowDown, ChevronDown, CheckCircle2, AlertCircle, Clock, Zap, Download, ShieldCheck } from "lucide-react";
import { formatBytes } from "@/lib/formatters";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface DownloadListProps {
  downloads: DownloadItem[];
  filter: FileType | "all";
  setDownloads: React.Dispatch<React.SetStateAction<DownloadItem[]>>;
  selectedIds: Set<string>;
  onToggleSelection: (id: string) => void;
  onToggleSelectAll: () => void;
}

export function DownloadList({ downloads, filter, setDownloads, selectedIds, onToggleSelection, onToggleSelectAll }: DownloadListProps) {
  const { toast } = useToast();
  const filteredDownloads = filter === "all"
    ? downloads
    : downloads.filter(d => d.type === filter);

  return (
    <div className="w-full overflow-hidden rounded-lg border border-border bg-card/30 backdrop-blur-sm">
      <div className="grid grid-cols-[3rem_3rem_minmax(300px,1fr)_120px_100px_100px_100px_120px] gap-4 p-3 bg-secondary/50 text-xs font-medium text-muted-foreground uppercase tracking-wider border-b border-border items-center">
        <div className="flex justify-center">
          <input
            type="checkbox"
            className="w-4 h-4 rounded border-border bg-background accent-primary cursor-pointer"
            checked={downloads.length > 0 && selectedIds.size === downloads.length}
            onChange={onToggleSelectAll}
          />
        </div>
        <div className="text-center">#</div>
        <div>File Name</div>
        <div>Size</div>
        <div>Status</div>
        <div>Speed</div>
        <div>ETA</div>
        <div className="text-right pr-4">Actions</div>
      </div>

      <div className="divide-y divide-border/50">
        {filteredDownloads.map((item, index) => {
          const Icon = getIconForType(item.type);
          const isDownloading = item.status === "downloading";

          return (
            <div
              key={item.id}
              className={cn(
                "grid grid-cols-[3rem_3rem_minmax(300px,1fr)_120px_100px_100px_100px_120px] gap-4 p-3 items-center group transition-colors hover:bg-white/5",
                item.status === "completed" && "opacity-75 hover:opacity-100",
                selectedIds.has(item.id) && "bg-primary/5"
              )}
            >
              <div className="flex justify-center">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded border-border bg-background accent-primary cursor-pointer"
                  checked={selectedIds.has(item.id)}
                  onChange={() => onToggleSelection(item.id)}
                />
              </div>
              <div className="text-center text-muted-foreground font-mono text-sm">{index + 1}</div>

              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-3 mb-1.5">
                  <div className={cn(
                    "p-1.5 rounded-md",
                    item.type === "video" ? "bg-blue-500/10 text-blue-500" :
                      item.type === "audio" ? "bg-purple-500/10 text-purple-500" :
                        item.type === "archive" ? "bg-amber-500/10 text-amber-500" :
                          "bg-zinc-500/10 text-zinc-500"
                  )}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <span className="font-medium text-sm truncate" title={item.name}>{item.name}</span>
                  {item.priority && item.priority !== 'normal' && (
                    <span className={cn(
                      "text-[8px] px-1.5 py-0.5 rounded font-black uppercase tracking-tighter",
                      item.priority === 'high' ? "bg-red-500/20 text-red-400 border border-red-500/20" : "bg-blue-500/20 text-blue-400 border border-blue-500/20"
                    )}>
                      {item.priority}
                    </span>
                  )}
                </div>

                {/* Progress Bar */}
                <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-500 ease-out",
                      item.status === "completed" ? "bg-green-500" :
                        item.status === "error" ? "bg-destructive" :
                          item.status === "paused" ? "bg-yellow-500" :
                            "bg-primary relative overflow-hidden"
                    )}
                    style={{ width: `${Math.min(100, item.progress)}%` }}
                  >
                    {isDownloading && (
                      <div className="absolute inset-0 bg-white/30 w-full animate-[shimmer_1s_infinite] skew-x-[-20deg]" />
                    )}
                  </div>
                </div>
                <div className="flex justify-between mt-1 text-[10px] text-muted-foreground font-mono">
                  <div className="flex items-center gap-2">
                    <span>{item.status === 'completed' ? 'Done' : `${Math.min(100, item.progress).toFixed(1)}%`}</span>
                    {isDownloading && item.connections && (
                      <span className="text-secondary-foreground/40 bg-white/5 px-1.5 rounded flex items-center gap-1">
                        <Zap className="w-2.5 h-2.5 text-yellow-500/50" /> {item.connections} conn
                      </span>
                    )}
                    {isDownloading && item.segmentsTotal && (
                      <span className="text-muted-foreground">
                        {item.merging ? (
                          <span className="text-blue-400 animate-pulse flex items-center gap-1">
                            <RefreshCw className="w-3 h-3 animate-spin" /> Merging...
                          </span>
                        ) : (
                          <>
                            {item.downloadedBytes ? formatBytes(item.downloadedBytes) : "0 B"} / {item.totalBytes ? formatBytes(item.totalBytes) : "Unknown"}
                            {item.segmentsTotal && item.segmentsTotal > 0 && (
                              <span className="ml-2 text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground uppercase tracking-tight">
                                Segments: {item.segmentsDone || 0}/{item.segmentsTotal}
                              </span>
                            )}
                          </>
                        )}
                      </span>
                    )}
                  </div>
                  <span>{isDownloading ? item.url.split('/')[2] : ''}</span>
                </div>
              </div>

              <div className="text-sm font-mono text-muted-foreground">
                {item.totalBytes ? formatBytes(item.totalBytes) : item.size || "Unknown"}
              </div>

              <div>
                <span className={cn(
                  "px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider",
                  item.status === "downloading" ? "bg-primary/20 text-primary border border-primary/20" :
                    item.status === "completed" ? "bg-green-500/20 text-green-500 border border-green-500/20" :
                      item.status === "paused" ? "bg-yellow-500/20 text-yellow-500 border border-yellow-500/20" :
                        item.status === "queued" ? "bg-secondary text-muted-foreground border border-border" :
                          item.status === "scheduled" ? "bg-blue-500/20 text-blue-400 border border-blue-500/20" :
                            item.status === "retrying" ? "bg-orange-500/20 text-orange-400 border border-orange-500/20 animate-pulse" :
                              "bg-destructive/20 text-destructive border border-destructive/20"
                )}>
                  {item.status === 'downloading' && item.progress >= 100 ? 'Finalizing' : (item.status === 'queued' ? 'In Queue' : item.status)}
                  {item.status === 'scheduled' && item.scheduledAt && (
                    <span className="ml-1 opacity-60 normal-case font-mono">
                      @ {new Date(item.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </span>
              </div>

              <div className="text-sm font-mono text-muted-foreground">
                {isDownloading ? item.speed : "-"}
              </div>

              <div className="text-sm font-mono text-muted-foreground">
                {isDownloading ? item.eta : item.status === 'completed' ? 'Finished' : '-'}
              </div>

              <div className="flex justify-end pr-2">
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {item.status === "completed" ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      onClick={async () => {
                        const electronAPI = (window as any).electronAPI;
                        if (electronAPI?.openFolder) {
                          // We need the full path. The item mock data might not have it if it wasn't persisted fully, 
                          // but our new backend sends it.
                          // Assuming item.outPath is available (we need to ensure it's in the interface)
                          // The current DownloadItem interface in mock-data might need updating if we strictly type it, 
                          // but here we are using it as 'any' effectively from the backend.
                          // Let's try to query the backend list or assume the state has it.
                          // Actually, App.tsx maps the backend response. Let's make sure it includes outPath.
                          // For now, let's look at how we get the path.
                          // Wait, the 'item' here comes from props. App.tsx constructs it.
                          // We need to pass 'outPath' from App.tsx. I will update App.tsx next.
                          // For now, let's implement the call assuming `item.outPath` exists.
                          await electronAPI.openFolder((item as any).outPath);
                        } else {
                          toast({ title: "Opening folder...", description: "File location will open" });
                        }
                      }}
                      title="Open Folder"
                    >
                      <FolderOpen className="w-4 h-4" />
                    </Button>
                  ) : item.status === "paused" ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      onClick={async () => {
                        const electronAPI = (window as any).electronAPI;
                        if (electronAPI?.resumeDownload) {
                          const res = await electronAPI.resumeDownload(item.id);
                          if (res?.ok) {
                            toast({ title: "Download Resumed", description: `Resuming ${item.name}` });
                          } else {
                            toast({ title: "Error", description: res?.message || "Failed to resume" });
                          }
                        }
                      }}
                    >
                      <Play className="w-4 h-4" />
                    </Button>
                  ) : item.status === "downloading" ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      onClick={async () => {
                        const electronAPI = (window as any).electronAPI;
                        if (electronAPI?.pauseDownload) {
                          const res = await electronAPI.pauseDownload(item.id);
                          if (res?.ok) {
                            toast({ title: "Download Paused", description: `Paused ${item.name}` });
                          } else {
                            toast({ title: "Error", description: res?.message || "Failed to pause" });
                          }
                        }
                      }}
                    >
                      <Pause className="w-4 h-4" />
                    </Button>
                  ) : (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      onClick={async () => {
                        const electronAPI = (window as any).electronAPI;
                        if (electronAPI?.resumeDownload) {
                          const res = await electronAPI.resumeDownload(item.id);
                          if (res?.ok) {
                            toast({ title: "Download Resumed", description: `Resuming ${item.name}` });
                          } else {
                            toast({ title: "Error", description: res?.message || "Failed to resume" });
                          }
                        }
                      }}
                    >
                      <RefreshCw className="w-4 h-4" />
                    </Button>
                  )}

                  {item.status === "queued" && (
                    <>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        onClick={() => (window as any).electronAPI?.moveUpDownload(item.id)}
                        title="Move Up"
                      >
                        <ArrowUp className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        onClick={() => (window as any).electronAPI?.moveDownDownload(item.id)}
                        title="Move Down"
                      >
                        <ArrowDown className="w-4 h-4" />
                      </Button>
                    </>
                  )}

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-foreground" data-testid={`button-actions-${item.id}`}>
                        <MoreHorizontal className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="bg-card border-border">
                      <DropdownMenuItem className="gap-2" onClick={() => {
                        const electronAPI = (window as any).electronAPI;
                        if (electronAPI?.openFile) {
                          electronAPI.openFile((item as any).outPath);
                        }
                      }}><FolderOpen className="w-4 h-4" /> Open File</DropdownMenuItem>
                      <DropdownMenuItem className="gap-2"><Download className="w-4 h-4" /> Redownload</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="gap-2"><ShieldCheck className="w-4 h-4" /> Scan for Viruses</DropdownMenuItem>
                      <DropdownMenuItem className="gap-2"><Zap className="w-4 h-4" /> Maximize Speed</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={async () => {
                          const electronAPI = (window as any).electronAPI;
                          if (electronAPI?.cancelDownload) {
                            const res = await electronAPI.cancelDownload(item.id);
                            if (res?.ok) {
                              toast({ title: "Download Cancelled", description: `Cancelled ${item.name}` });
                            }
                          } else {
                            navigator.clipboard.writeText(item.url);
                            toast({ title: "Link Copied", description: "Download URL copied to clipboard" });
                          }
                        }}
                      >
                        {(window as any).electronAPI ? 'Cancel Download' : 'Copy Download Link'}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => {
                        toast({ title: "Priority Increased", description: `${item.name} is now at the top of the queue` });
                      }}>Move to Top</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={async () => {
                          const electronAPI = (window as any).electronAPI;
                          if (electronAPI?.deleteDownload) {
                            const success = await electronAPI.deleteDownload(item.id);
                            if (success) {
                              setDownloads(prev => prev.filter(d => d.id !== item.id));
                              toast({ title: "Deleted", description: `${item.name} removed from list` });
                            } else {
                              toast({ title: "Delete Failed", description: "Could not remove download", variant: "destructive" });
                            }
                          } else {
                            // Fallback for mock
                            setDownloads(prev => prev.filter(d => d.id !== item.id));
                            toast({ title: "Deleted", description: `(Mock) ${item.name} removed` });
                          }
                        }}
                      >Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {filteredDownloads.length === 0 && (
        <div className="h-64 flex flex-col items-center justify-center text-muted-foreground">
          <div className="w-16 h-16 rounded-full bg-secondary/50 flex items-center justify-center mb-4">
            <Download className="w-8 h-8 opacity-20" />
          </div>
          <p>No downloads found</p>
        </div>
      )}
    </div>
  );
}
