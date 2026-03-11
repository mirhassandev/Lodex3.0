import React from "react";
import { DownloadItem } from "@/lib/mock-data";
import { formatBytes, formatSpeed, formatEta } from "@/lib/formatters";
import { Minus, X } from "lucide-react";

interface DialogProgressViewProps {
    download: DownloadItem;
    onClose: () => void;
    onPause: () => void;
    onResume: () => void;
    onCancel: () => void;
}

export function DialogProgressView({ download, onClose, onPause, onResume, onCancel }: DialogProgressViewProps) {
    const electronAPI = (window as any).electronAPI;

    const handleOpenFolder = () => {
        if (download.outPath && electronAPI?.openFolder) {
            electronAPI.openFolder(download.outPath);
            onClose();
        }
    };

    const handleOpenFile = () => {
        if (download.outPath && electronAPI?.openFile) {
            electronAPI.openFile(download.outPath);
            onClose();
        }
    };

    const handleMinimize = () => {
        if (electronAPI?.minimize) {
            electronAPI.minimize();
        }
    };

    const isComplete = download.status === "completed";
    const isFailed = download.status === "error";
    const isPaused = download.status === "paused";

    // Real-time values mapped from download state
    const progressText = download.progress ? download.progress.toFixed(2) : "0.00";

    // Normalize speed format using formatters if backend sends raw number
    let speedText = download.speed || "Calculating...";
    if (typeof download.speed === 'number') speedText = formatSpeed(download.speed);

    // Normalize ETA
    let timeLeftText = download.eta || "Calculating...";
    if (typeof download.eta === 'number') timeLeftText = formatEta(download.eta);

    const downloadedText = download.downloadedBytes ? formatBytes(download.downloadedBytes) : "0 B";
    const fileSizeText = download.totalBytes ? formatBytes(download.totalBytes) : (download.size || "Unknown");

    let statusText = "Receiving data...";
    if (isComplete) statusText = "Finished";
    else if (isPaused) statusText = "Paused";
    else if (isFailed) statusText = "Error";
    else if (download.status === 'queued') statusText = "In Queue";

    return (
        <div className="idm-dialog h-full w-full max-w-[500px] max-h-[400px] absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
            <div
                style={{ WebkitAppRegion: 'drag' } as any}
                className="flex items-center justify-between mb-4 pb-2 border-b border-border cursor-move"
            >
                <div className="flex items-center gap-2">
                    <img src="./icon.png" className="w-4 h-4 opacity-80" alt="" onError={(e) => e.currentTarget.style.display = 'none'} />
                    <h3 className="m-0 text-[14px] font-medium text-foreground p-0 border-none" style={{ WebkitAppRegion: 'no-drag' } as any}>
                        Download Progress
                    </h3>
                </div>

                <div className="flex items-center gap-2 ml-auto" style={{ WebkitAppRegion: 'no-drag' } as any}>
                    <button
                        onClick={handleMinimize}
                        className="w-3 h-3 rounded-full bg-[#febc2e] hover:bg-[#febc2ecc] border border-[#d8a120] transition-colors"
                        title="Minimize"
                    />
                    <button
                        onClick={onClose}
                        className="w-3 h-3 rounded-full bg-[#ff5f57] hover:bg-[#ff5f57cc] border border-[#e0443e] transition-colors"
                        title="Close"
                    />
                </div>
            </div>

            <div className="text-[13px] font-semibold text-foreground mb-4 truncate drop-shadow-sm" title={download.name}>
                {download.name}
            </div>

            <div className="download-info">
                <p><b>Status:</b></p><p>{statusText}</p>
                <p><b>File size:</b></p><p>{fileSizeText}</p>
                <p><b>Downloaded:</b></p><p className="text-primary font-medium">{downloadedText} ({progressText}%)</p>
                <p><b>Transfer rate:</b></p><p>{speedText}</p>
                <p><b>Time left:</b></p><p>{timeLeftText}</p>
                <p><b>Resume capability:</b></p><p>Yes</p>
            </div>

            <div className="progress-container">
                <div className="progress-bar" style={{ width: `${download.progress || 0}%` }} />
            </div>

            <SegmentBars connCount={download.connections || 8} progress={download.progress || 0} isComplete={isComplete} />

            <div className="controls mt-5">
                {isComplete ? (
                    <>
                        <button onClick={handleOpenFile}>Open</button>
                        <button onClick={handleOpenFolder}>Open Folder</button>
                        <button onClick={onClose} className="!border-primary/50 hover:!bg-primary/20">Close</button>
                    </>
                ) : (
                    <>
                        {isPaused ? (
                            <button onClick={onResume}>Resume</button>
                        ) : (
                            <button onClick={onPause}>Pause</button>
                        )}
                        <button onClick={onClose} title="Hide the dialog but continue downloading">Hide</button>
                        <button onClick={onCancel} className="hover:!border-destructive !text-destructive/80 hover:!text-destructive hover:!bg-destructive/10">Cancel</button>
                    </>
                )}
            </div>
        </div>
    );
}

function SegmentBars({ connCount, progress, isComplete }: { connCount: number, progress: number, isComplete: boolean }) {
    const segments = new Array(Math.max(1, connCount)).fill(0);

    return (
        <div className="segments">
            {segments.map((_, i) => {
                const segmentProgress = isComplete ? 100 : Math.min(100, Math.max(0, (progress - (i * (100 / segments.length))) * segments.length));

                return (
                    <div key={i} className="segment">
                        <div
                            className="segment-fill"
                            style={{ width: `${segmentProgress}%` }}
                        />
                    </div>
                );
            })}
        </div>
    );
}
