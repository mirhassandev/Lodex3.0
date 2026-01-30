import React, { useState, useEffect, useRef } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Toolbar } from "@/components/downloads/Toolbar";
import { DownloadList } from "@/components/downloads/DownloadList";
import { mockDownloads, DownloadItem, FileType, getFileType } from "@/lib/mock-data";
import { Toaster } from "@/components/ui/toaster";
import { useToast } from "@/hooks/use-toast";
import { AdvancedToolsModal } from "@/components/downloads/AdvancedToolsModal";

// Helper to calculate speed and ETA
const calculateSpeedAndEta = (downloaded: number, total: number, previousDownloaded: number, previousTime: number, currentTime: number) => {
  const timeDelta = (currentTime - previousTime) / 1000; // in seconds
  if (timeDelta <= 0) return { speed: "0 KB/s", eta: "Calculating..." };

  const bytesDelta = downloaded - previousDownloaded;
  const speedBytesPerSec = Math.max(0, bytesDelta / timeDelta);
  const remainingBytes = Math.max(0, total - downloaded);
  const etaSeconds = speedBytesPerSec > 0 ? remainingBytes / speedBytesPerSec : 0;

  // Format speed
  let speed = "0 KB/s";
  if (speedBytesPerSec > 1024 * 1024) {
    speed = `${(speedBytesPerSec / (1024 * 1024)).toFixed(2)} MB/s`;
  } else if (speedBytesPerSec > 1024) {
    speed = `${(speedBytesPerSec / 1024).toFixed(2)} KB/s`;
  } else {
    speed = `${speedBytesPerSec.toFixed(2)} B/s`;
  }

  // Format ETA
  let eta = "Calculating...";
  if (etaSeconds === 0 && remainingBytes === 0) {
    eta = "Finished";
  } else if (etaSeconds < 0 || !isFinite(etaSeconds)) {
    eta = "Calculating...";
  } else if (etaSeconds < 60) {
    eta = `${Math.ceil(etaSeconds)}s`;
  } else if (etaSeconds < 3600) {
    eta = `${Math.ceil(etaSeconds / 60)}m`;
  } else {
    eta = `${Math.ceil(etaSeconds / 3600)}h`;
  }

  return { speed, eta };
};

function App() {
  const [activeFilter, setActiveFilter] = useState<FileType | "all">("all");
  const [downloads, setDownloads] = useState<DownloadItem[]>(mockDownloads);
  const [searchQuery, setSearchQuery] = useState("");
  const [advancedToolsOpen, setAdvancedToolsOpen] = useState(false);
  const [initialTab, setInitialTab] = useState("scheduler");
  const { toast } = useToast();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const speedTrackingRef = useRef<Record<string, { downloaded: number; timestamp: number }>>({});

  const openAdvancedTools = (tab?: string) => {
    if (tab) setInitialTab(tab);
    setAdvancedToolsOpen(true);
  };

  const handleAddDownload = async (url: string, youtubeOptions?: { quality?: string, title?: string }) => {
    // Validate URL
    try {
      new URL(url);
    } catch (err) {
      toast({ title: "Invalid URL", description: "Please enter a valid URL" });
      return;
    }

    // Determine type based on URL (legacy logic kept for optimisitc UI, but backend handles real work)
    let type: FileType = "document";
    let name = "downloaded_file";

    const electronAPI = (window as any).electronAPI;
    if (electronAPI && electronAPI.startDownload) {
      try {
        const res = await electronAPI.startDownload(url, youtubeOptions);
        if (res && res.ok) {
          const itemWithId: DownloadItem = {
            id: res.id,
            name: res.filename || name,
            url: url,
            status: 'downloading',
            progress: 0,
            downloadedBytes: 0,
            totalBytes: res.size || 0,
            speed: '0 KB/s',
            eta: 'Calculating...',
            type: getFileType(res.filename || name), // Dynamically determine type
            dateAdded: new Date().toISOString().split('T')[0],
            outPath: res.outPath,
            size: res.size ? `${(res.size / (1024 * 1024)).toFixed(2)} MB` : "Calculating..."
          };
          setDownloads(prev => [itemWithId, ...prev]);
          toast({ title: "Download Started", description: `Started downloading ${itemWithId.name}` });
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
      size: "100 MB"
    };
    setDownloads(prev => [newDownload, ...prev]);
    toast({
      title: "Download Started",
      description: `Started downloading ${name}`,
    });
  };

  // Wire electron download events (progress/finished/error/clipboard)
  useEffect(() => {
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI) return;

    // Load initial downloads
    if (electronAPI.listDownloads) {
      electronAPI.listDownloads().then((initial: any[]) => {
        console.log("Loaded initial tasks:", initial);
        // Map keys if needed, assuming match
        setDownloads(initial.map(d => ({
          id: d.id,
          name: d.name || d.outPath.split(/[\\/]/).pop(),
          size: d.size,
          totalBytes: d.size,
          downloadedBytes: d.downloaded,
          progress: d.size ? (d.downloaded / d.size) * 100 : 0,
          speed: d.status === 'downloading' ? 'Resuming...' : '0 KB/s',
          status: d.status,
          type: getFileType(d.name || d.outPath.split(/[\\/]/).pop() || ''), // determine type from filename
          url: d.url,
          eta: '',
          dateAdded: d.dateAdded || new Date().toISOString().split('T')[0],
          outPath: d.outPath
        })));
      });
    }

    let unsubClipboard: (() => void) | undefined;
    if (electronAPI.onDownloadDetected) {
      unsubClipboard = electronAPI.onDownloadDetected((url: string) => {
        toast({
          title: "Link Detected",
          description: `Found link in clipboard: ${url}. click to download`,
          action: <button className="cursor-pointer bg-primary text-primary-foreground px-3 py-1 rounded hover:bg-primary/90" onClick={() => handleAddDownload(url)}>Download</button>
        });
      });
    }

    if (!electronAPI.onDownloadEvent) return;

    const unsubProgress = electronAPI.onDownloadEvent('progress', (data: any) => {
      const now = Date.now();
      const prevTracking = speedTrackingRef.current[data.id] || { downloaded: 0, timestamp: now };

      // Calculate speed and ETA
      const { speed, eta } = calculateSpeedAndEta(data.downloaded, data.total, prevTracking.downloaded, prevTracking.timestamp, now);

      // Update tracking
      speedTrackingRef.current[data.id] = { downloaded: data.downloaded, timestamp: now };

      setDownloads(prev => prev.map(d => d.id === data.id ? {
        ...d,
        downloadedBytes: data.downloaded,
        totalBytes: data.total,
        progress: data.total ? Math.min(100, Math.round((data.downloaded / data.total) * 100)) : d.progress,
        speed,
        eta
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
      setDownloads(prev => prev.map(d => d.id === data.id ? { ...d, totalBytes: data.size, status: 'downloading' } : d));
      speedTrackingRef.current[data.id] = { downloaded: 0, timestamp: Date.now() };
    });

    const unsubPaused = electronAPI.onDownloadEvent('paused', (data: any) => {
      setDownloads(prev => prev.map(d => d.id === data.id ? { ...d, status: 'paused', speed: 'Paused' } : d));
    });

    const unsubResumed = electronAPI.onDownloadEvent('resumed', (data: any) => {
      setDownloads(prev => prev.map(d => d.id === data.id ? { ...d, status: 'downloading', speed: 'Resuming...' } : d));
      speedTrackingRef.current[data.id] = { downloaded: data.downloaded, timestamp: Date.now() };
    });

    const unsubCancelled = electronAPI.onDownloadEvent('cancelled', (data: any) => {
      setDownloads(prev => prev.map(d => d.id === data.id ? { ...d, status: 'paused' } : d));
      delete speedTrackingRef.current[data.id];
    });

    return () => {
      try { unsubProgress && unsubProgress(); } catch { }
      try { unsubFinished && unsubFinished(); } catch { }
      try { unsubError && unsubError(); } catch { }
      try { unsubStarted && unsubStarted(); } catch { }
      try { unsubPaused && unsubPaused(); } catch { }
      try { unsubResumed && unsubResumed(); } catch { }
      try { unsubCancelled && unsubCancelled(); } catch { }
      try { unsubClipboard && unsubClipboard(); } catch { }
    };
  }, [toast, handleAddDownload]); // Added handleAddDownload to dependencies

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
      />
      <Toaster />
    </div>
  );
}

export default App;
