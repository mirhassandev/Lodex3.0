import React, { useState, useEffect, useRef, useCallback } from "react";
import { Download } from "lucide-react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Toolbar } from "@/components/downloads/Toolbar";
import { DownloadList } from "@/components/downloads/DownloadList";
import { mockDownloads, DownloadItem, FileType, getFileType, DownloadStatus } from "@/lib/mock-data";
import { Toaster } from "@/components/ui/toaster";
import { useToast } from "@/hooks/use-toast";
import { AdvancedToolsModal } from "@/components/downloads/AdvancedToolsModal";
import { NewDownloadDialog } from "@/components/downloads/NewDownloadDialog";
import { formatSpeed, formatEta } from "@/lib/formatters";

function App() {
  const [activeFilter, setActiveFilter] = useState<FileType | "all">("all");
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [advancedToolsOpen, setAdvancedToolsOpen] = useState(false);
  const [initialTab, setInitialTab] = useState("scheduler");
  const { toast } = useToast();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const speedTrackingRef = useRef<Record<string, { downloaded: number; timestamp: number }>>({});
  const [pendingDownload, setPendingDownload] = useState<{ url: string, headers?: any, meta?: any } | null>(null);

  useEffect(() => {
    // Initial fetch from API
    fetch('/api/settings')
      .then(r => {
        if (!r.ok) throw new Error('Failed to load settings');
        return r.json();
      })
      .then(data => {
        if (!data || typeof data !== 'object') return;
        setSettings(data);
        if (data.darkMode !== undefined) {
          if (data.darkMode) document.documentElement.classList.add('dark');
          else document.documentElement.classList.remove('dark');
        }
      }).catch(err => {
        console.error('[App] Settings fetch error:', err);
      });

    fetch('/api/downloads')
      .then(r => {
        if (!r.ok) throw new Error('Failed to load downloads');
        return r.json();
      })
      .then(dls => {
        if (!Array.isArray(dls)) {
          console.error('[App] Downloads API returned non-array:', dls);
          return;
        }
        setDownloads(dls.map((d: any) => ({
          id: d.id,
          name: d.filename,
          size: d.size ? `${(d.size / (1024 * 1024)).toFixed(2)} MB` : "Unknown",
          totalBytes: d.size || 0,
          downloadedBytes: d.progress ? Math.floor((d.progress / 100) * (d.size || 0)) : 0,
          progress: d.progress || 0,
          speed: d.status === 'downloading' ? 'Resuming...' : '0 KB/s',
          status: (d.status || 'queued') as DownloadStatus,
          priority: (d.priority || 'normal') as any,
          type: getFileType(d.filename),
          url: d.url,
          eta: '',
          dateAdded: d.createdAt ? new Date(d.createdAt).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
          outPath: d.filePath,
          scheduledAt: d.scheduledAt,
          retryCount: d.retryCount
        })));
      }).catch(err => {
        console.error('[App] Downloads fetch error:', err);
      });
  }, []);

  const openAdvancedTools = (tab?: string) => {
    if (tab) setInitialTab(tab);
    setAdvancedToolsOpen(true);
  };

  const handleAddDownload = useCallback(async (url: string, youtubeOptions?: { filename?: string, quality?: string, title?: string, variantUrl?: string, type?: string, priority?: string, scheduledAt?: string, status?: string, headers?: Record<string, string> }) => {
    // Validate URL
    try {
      new URL(url);
    } catch (err) {
      toast({ title: "Invalid URL", description: "Please enter a valid URL" });
      return;
    }

    const electronAPI = (window as any).electronAPI;

    // Smart classification — pre-resolve filename, type, and size
    let classifiedMeta: any = null;
    let type: FileType = "document";
    let name = "downloaded_file";

    try {
      if (electronAPI && electronAPI.classifyUrl) {
        classifiedMeta = await electronAPI.classifyUrl(url);
        if (classifiedMeta && classifiedMeta.ok) {
          type = (classifiedMeta.type as FileType) || 'document';
          name = classifiedMeta.filename || name;
        }
      }
    } catch (e) {
      console.warn('[Classify] Failed to classify URL, using defaults', e);
    }

    if (electronAPI && electronAPI.startDownload) {
      try {
        // Merge classifiedMeta and custom headers into options
        const isYouTube = url.includes('youtube.com') || url.includes('youtu.be');
        const startOptions = {
          ...youtubeOptions,
          headers: { ...(pendingDownload?.headers || {}), ...(youtubeOptions?.headers || {}) },
          filename: youtubeOptions?.filename || (isYouTube && youtubeOptions?.title ? (youtubeOptions.title + '.mp4') : (classifiedMeta?.filename || name)),
          protocol: classifiedMeta?.protocol,
          type: classifiedMeta?.type,
          priority: youtubeOptions?.priority,
          scheduledAt: youtubeOptions?.scheduledAt,
        };
        const res = await electronAPI.startDownload(url, startOptions);
        if (res && res.ok) {
          const itemWithId: DownloadItem = {
            id: res.id,
            name: res.filename || youtubeOptions?.filename || name,
            url: url,
            status: (res.status || 'downloading') as DownloadStatus,
            progress: 0,
            downloadedBytes: 0,
            totalBytes: res.size || 0,
            speed: '0 KB/s',
            eta: 'Calculating...',
            type: getFileType(res.filename || youtubeOptions?.filename || name), // Dynamically determine type
            dateAdded: new Date().toISOString().split('T')[0],
            outPath: res.outPath,
            size: res.size ? `${(res.size / (1024 * 1024)).toFixed(2)} MB` : "Calculating...",
            priority: (youtubeOptions?.priority || 'normal') as any,
            scheduledAt: youtubeOptions?.scheduledAt ? new Date(youtubeOptions.scheduledAt).getTime() : undefined,
            retryCount: 0
          };
          setDownloads(prev => [itemWithId, ...prev]);
          toast({ title: "Download Started", description: `Started downloading ${itemWithId.name}` });

          // Phase 8: If in dialog mode, close the window after a short delay
          if (window.location.search.includes("dialog=true")) {
            setTimeout(() => {
              if (electronAPI.closeDialog) electronAPI.closeDialog();
            }, 800);
          }
          return;
        } else {
          toast({ title: "Download Failed", description: res?.message || 'Unable to start' });
          return;
        }
      } catch (err: any) {
        toast({ title: "Download Error", description: err?.message || String(err) });
        return;
      }
    }

    // fallback to local mock when not running inside desktop
    const newDownload: DownloadItem = {
      id: `mock-${Date.now()}`,
      name: name,
      url: url,
      status: 'downloading',
      progress: 0,
      downloadedBytes: 0,
      totalBytes: 100 * 1024 * 1024, // 100 MB mock size
      speed: '0 KB/s',
      eta: 'Calculating...',
      type: type,
      dateAdded: new Date().toISOString().split('T')[0],
      outPath: `/path/to/mock/${name}`,
      size: "100 MB",
      priority: "normal"
    };
    setDownloads(prev => [newDownload, ...prev]);
    toast({
      title: "Download Started",
      description: `Started downloading ${name}`,
    });
  }, [toast, pendingDownload]);

  // Wire electron download events (progress/finished/error/clipboard)
  useEffect(() => {
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI) return;

    // Initial load now relies on Express API, no longer IPC listDownloads.

    let unsubClipboard: (() => void) | undefined;
    if (electronAPI.onDownloadDetected) {
      unsubClipboard = electronAPI.onDownloadDetected((source: string, url: string, headers?: any, meta?: any) => {
        const isBrowser = source === 'browser' || source === 'media-sniffer';
        console.log(`[App] Download detected from ${source}:`, url, meta);

        // IDM Powerhouse: Open the dedicated dialog instead of just a toast
        setPendingDownload({ url, headers, meta });

        toast({
          title: isBrowser ? "Stream Detected 🚀" : "Link Detected 📋",
          description: "New download information received. Opening dialog...",
          duration: 3000
        });
      });
    }

    if (!electronAPI.onDownloadEvent) return;

    const unsubCreated = electronAPI.onDownloadEvent('created', (data: any) => {
      setDownloads(prev => {
        // Prevent duplicates if handleAddDownload already added it
        if (prev.find(d => d.id === data.id)) return prev;
        
        const newItem: DownloadItem = {
          id: data.id,
          name: data.name,
          url: data.url,
          status: data.status as DownloadStatus,
          progress: 0,
          downloadedBytes: 0,
          totalBytes: data.size || 0,
          speed: '0 KB/s',
          eta: 'Starting...',
          type: getFileType(data.name),
          dateAdded: data.dateAdded || new Date().toISOString().split('T')[0],
          outPath: data.outPath,
          size: data.size ? `${(data.size / (1024 * 1024)).toFixed(2)} MB` : "Calculating...",
          priority: 'normal',
          retryCount: 0
        };
        return [newItem, ...prev];
      });
    });

    const unsubProgress = electronAPI.onDownloadEvent('progress', (data: any) => {
      const speedStr = data.speed ? formatSpeed(data.speed) : 'Calculating...';
      const etaStr = data.eta ? formatEta(data.eta) : 'Calculating...';

      setDownloads(prev => prev.map(d => d.id === data.id ? {
        ...d,
        downloadedBytes: data.downloaded,
        totalBytes: data.total,
        progress: data.total ? Math.min(100, (data.downloaded / data.total) * 100) : d.progress,
        speed: speedStr,
        eta: etaStr,
        connections: data.connections,
        segmentsDone: data.segmentsDone,
        segmentsTotal: data.segmentsTotal,
        merging: data.merging
      } : d));
    });

    const unsubFinished = electronAPI.onDownloadEvent('finished', (data: any) => {
      setDownloads(prev => prev.map(d => d.id === data.id ? { ...d, status: 'completed', progress: 100, speed: '0 KB/s', eta: 'Finished' } : d));
      toast({ title: 'Download Finished', description: `Download completed` });
      delete speedTrackingRef.current[data.id];
    });

    const unsubError = electronAPI.onDownloadEvent('error', (data: any) => {
      setDownloads(prev => prev.map(d => d.id === data.id ? { ...d, status: 'error' } : d));
      toast({ title: 'Download Error', description: data?.message || 'An error occurred' });
      delete speedTrackingRef.current[data.id];
    });

    const unsubStarted = electronAPI.onDownloadEvent('started', (data: any) => {
      setDownloads(prev => prev.map(d => d.id === data.id ? { ...d, totalBytes: data.size, status: 'downloading', speed: 'Starting...' } : d));
    });

    const unsubPaused = electronAPI.onDownloadEvent('paused', (data: any) => {
      setDownloads(prev => prev.map(d => d.id === data.id ? { ...d, status: 'paused', speed: 'Paused' } : d));
    });

    const unsubResumed = electronAPI.onDownloadEvent('resumed', (data: any) => {
      setDownloads(prev => prev.map(d => d.id === data.id ? { ...d, status: 'downloading', speed: 'Resuming...' } : d));
    });

    const unsubCancelled = electronAPI.onDownloadEvent('cancelled', (data: any) => {
      setDownloads(prev => prev.map(d => d.id === data.id ? { ...d, status: 'paused' } : d));
      delete speedTrackingRef.current[data.id];
    });

    // New queue events
    const unsubScheduled = electronAPI.onDownloadEvent('scheduled', (data: any) => {
      setDownloads(prev => prev.map(d => d.id === data.id ? { ...d, status: 'scheduled' } : d));
    });

    const unsubRetrying = electronAPI.onDownloadEvent('retrying', (data: any) => {
      setDownloads(prev => prev.map(d => d.id === data.id ? { ...d, status: 'retrying', speed: 'Retrying...' } : d));
      toast({ title: 'Retrying Download', description: `Attempting to restart ${data.id}...` });
    });

    const unsubMerging = electronAPI.onDownloadEvent('merging', (data: any) => {
      setDownloads(prev => prev.map(d => d.id === data.id ? { ...d, merging: true, speed: 'Merging...' } : d));
    });

    return () => {
      try { unsubProgress && unsubProgress(); } catch { }
      try { unsubFinished && unsubFinished(); } catch { }
      try { unsubError && unsubError(); } catch { }
      try { unsubStarted && unsubStarted(); } catch { }
      try { unsubPaused && unsubPaused(); } catch { }
      try { unsubResumed && unsubResumed(); } catch { }
      try { unsubCancelled && unsubCancelled(); } catch { }
      try { unsubMerging && unsubMerging(); } catch { }
      try { unsubScheduled && unsubScheduled(); } catch { }
      try { unsubRetrying && unsubRetrying(); } catch { }
      try { unsubCreated && unsubCreated(); } catch { }
      try { unsubClipboard && unsubClipboard(); } catch { }
    };
  }, [toast, handleAddDownload]); // Added handleAddDownload to dependencies


  // Phase 8: Dialog Mode Rendering (IDM-style Popup)
  const params = new URLSearchParams(window.location.search);
  const isDialogMode = params.get("dialog") === "true";

  useEffect(() => {
    if (isDialogMode) {
      document.documentElement.classList.add('dialog-mode');
    } else {
      document.documentElement.classList.remove('dialog-mode');
    }
  }, [isDialogMode]);

  if (isDialogMode) {
    return (
      <div className="h-screen w-screen bg-transparent overflow-hidden">
        <NewDownloadDialog
          url={pendingDownload?.url || ""}
          headers={pendingDownload?.headers}
          meta={pendingDownload?.meta}
          onConfirm={(options: any) => handleAddDownload(pendingDownload?.url || "", options)}
          onCancel={() => {
            const electronAPI = (window as any).electronAPI;
            if (electronAPI?.closeDialog) electronAPI.closeDialog();
          }}
        />
        <Toaster />
      </div>
    );
  }

  return (
    <div
      className="flex h-screen w-screen overflow-hidden text-foreground bg-background font-sans selection:bg-primary/30"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) {
          toast({
            title: "Files Dropped",
            description: `Ready to upload ${files.length} file(s). (Mock Integration)`,
          });
        }
      }}
    >
      <Sidebar
        activeFilter={activeFilter}
        onFilterChange={setActiveFilter}
        onOpenAdvanced={openAdvancedTools}
        storageUsage={75}
      />

      <main className="flex-1 flex flex-col min-w-0">
        <Toolbar
          onAddDownload={handleAddDownload}
          onOpenAdvanced={openAdvancedTools}
          onPauseAll={async () => {
            const electronAPI = (window as any).electronAPI;
            if (!electronAPI?.pauseDownload) return;
            // Pause all 'downloading' items
            const active = downloads.filter(d => d.status === 'downloading');
            for (const d of active) {
              await electronAPI.pauseDownload(d.id);
            }
            toast({ title: "Paused All", description: `Paused ${active.length} downloads` });
          }}
          onResumeAll={async () => {
            const electronAPI = (window as any).electronAPI;
            if (!electronAPI?.resumeDownload) return;
            // Resume all 'paused' items
            const paused = downloads.filter(d => d.status === 'paused');
            for (const d of paused) {
              await electronAPI.resumeDownload(d.id);
            }
            toast({ title: "Resumed All", description: `Resumed ${paused.length} downloads` });
          }}
          onCancelAll={async () => {
            const electronAPI = (window as any).electronAPI;
            if (!electronAPI?.cancelDownload) return;
            // Cancel all active items
            const active = downloads.filter(d => d.status === 'downloading' || d.status === 'paused');
            for (const d of active) {
              await electronAPI.cancelDownload(d.id);
            }
            toast({ title: "Cancelled All", description: `Cancelled ${active.length} downloads` });
          }}
          onDeleteSelected={async () => {
            const electronAPI = (window as any).electronAPI;
            if (selectedIds.size === 0) {
              toast({ title: "No Selection", description: "Please select items to delete" });
              return;
            }
            let successCount = 0;
            const idsToDelete = Array.from(selectedIds);
            for (const id of idsToDelete) {
              const success = await electronAPI?.deleteDownload?.(id);
              if (success) {
                successCount++;
                setDownloads(prev => prev.filter(d => d.id !== id));
              }
            }
            setSelectedIds(new Set());
            toast({ title: "Deleted Selected", description: `Successfully removed ${successCount} downloads` });
          }}
          hasSelection={selectedIds.size > 0}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />

        <div className="flex-1 overflow-auto p-6 scroll-smooth">
          <DownloadList
            downloads={downloads.filter(d => d.name.toLowerCase().includes(searchQuery.toLowerCase()))}
            filter={activeFilter}
            setDownloads={setDownloads}
            selectedIds={selectedIds}
            onToggleSelection={(id: string) => {
              const next = new Set(selectedIds);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              setSelectedIds(next);
            }}
            onToggleSelectAll={() => {
              if (selectedIds.size === downloads.length) {
                setSelectedIds(new Set());
              } else {
                setSelectedIds(new Set(downloads.map(d => d.id)));
              }
            }}
          />
        </div>
      </main>
      <AdvancedToolsModal
        open={advancedToolsOpen}
        onOpenChange={setAdvancedToolsOpen}
        initialTab={initialTab}
        settings={settings}
        onSettingsChange={async (update: any) => {
          try {
            const res = await fetch('/api/settings', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(update)
            });
            const updated = await res.json();
            setSettings(updated);
            if (updated.darkMode !== undefined) {
              if (updated.darkMode) document.documentElement.classList.add('dark');
              else document.documentElement.classList.remove('dark');
            }
            toast({ title: "Settings Saved", description: "Successfully updated settings." });
          } catch (e) {
            toast({ title: "Error", description: "Failed to update settings." });
          }
        }}
      />

      {pendingDownload && (
        <NewDownloadDialog
          url={pendingDownload.url}
          filename={pendingDownload.meta?.filename}
          size={pendingDownload.meta?.size}
          headers={pendingDownload.headers}
          meta={pendingDownload.meta}
          onConfirm={(options: any) => {
            handleAddDownload(pendingDownload.url, options);
            setPendingDownload(null);
          }}
          onCancel={() => setPendingDownload(null)}
        />
      )}

      <Toaster />
    </div>
  );
}

export default App;
