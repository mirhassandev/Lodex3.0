import React, { useState, useEffect, useRef } from "react";
import { Download, X, FolderOpen, Zap, Clock, Loader2, Music, Film, List, Link, Check, ChevronDown, Info, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { motion, useDragControls } from "framer-motion";
import { toast } from "sonner";

interface QualityOption {
    formatId?: string;
    quality?: string;
    label: string;
    url?: string;
    filesize?: number;
    height?: number;
    type?: string;
    ext?: string;
}

interface MediaAnalysis {
    ok?: boolean;
    source?: string;
    title?: string;
    thumbnail?: string;
    uploader?: string;
    duration?: number;
    durationFormatted?: string;
    isLive?: boolean;
    isPlaylist?: boolean;
    playlistCount?: number;
    qualities?: QualityOption[];
    audio?: QualityOption[];
    isYouTube?: boolean;
    error?: string;
}

interface NewDownloadDialogProps {
    url: string;
    filename?: string;
    size?: number;
    headers?: Record<string, string>;
    meta?: any;
    defaultSavePath?: string;
    onConfirm: (options: any) => void;
    onCancel: () => void;
}

function formatFileSize(bytes?: number): string {
    if (!bytes || bytes === 0) return "Unknown";
    const kb = bytes / 1024;
    const mb = kb / 1024;
    const gb = mb / 1024;
    if (gb >= 1) return `${gb.toFixed(2)} GB`;
    if (mb >= 1) return `${mb.toFixed(1)} MB`;
    return `${kb.toFixed(0)} KB`;
}

export function NewDownloadDialog({ url, filename: initialFilename, size, headers, meta, defaultSavePath, onConfirm, onCancel }: NewDownloadDialogProps) {
    const [filename, setFilename] = useState(initialFilename || "downloaded_file");
    const [savePath, setSavePath] = useState(defaultSavePath || "C:\\Downloads");
    const [isSpeedBoost, setIsSpeedBoost] = useState(true);
    const [isLoading, setIsLoading] = useState(false);
    const [analyzeError, setAnalyzeError] = useState<string | null>(null);
    const [media, setMedia] = useState<MediaAnalysis | null>(null);
    const [selectedQualityId, setSelectedQualityId] = useState<string>("");
    const [isAudioOnly, setIsAudioOnly] = useState(!!meta?.isAudioOnly);
    const [scheduledAt, setScheduledAt] = useState<string>('');
    const [copied, setCopied] = useState(false);
    const [scheduledConfirmed, setScheduledConfirmed] = useState(false);

    const dragControls = useDragControls();
    const electronAPI = (window as any).electronAPI;
    const fileNameRef = useRef<HTMLInputElement>(null);

    const allQualities = media?.qualities || [];
    const audioOptions = media?.audio || [];
    const displayOptions = isAudioOnly ? audioOptions : allQualities;

    // ESC to close
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onCancel();
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [onCancel]);

    // Auto-focus filename
    useEffect(() => {
        if (!isLoading && fileNameRef.current) {
            fileNameRef.current.focus();
            fileNameRef.current.select();
        }
    }, [isLoading]);

    useEffect(() => {
        if (!url || !electronAPI?.analyzeMedia) return;
        setIsLoading(true);
        setAnalyzeError(null);

        electronAPI.analyzeMedia(url, meta || null, headers)
            .then((result: MediaAnalysis) => {
                if (result.error) {
                    setAnalyzeError(result.error);
                }
                setMedia(result);

                if (result.title && result.title !== 'Unknown') {
                    const safeTitle = result.title.replace(/[<>:"/\\|?*]/g, '_').substring(0, 80);
                    const rawExt = isAudioOnly ? 'mp3' : (result.qualities?.[0]?.ext || 'mp4');
                    const ext = rawExt.startsWith('.') ? rawExt : `.${rawExt}`;
                    setFilename(safeTitle + (safeTitle.toLowerCase().endsWith(ext.toLowerCase()) ? '' : ext));
                }

                const options = isAudioOnly ? result.audio : result.qualities;
                const best = options?.[0];
                if (best?.formatId || best?.quality) {
                    setSelectedQualityId(best.formatId || best.quality || '');
                }
            })
            .catch((e: any) => {
                setAnalyzeError(e?.message || 'Analysis failed');
            })
            .finally(() => setIsLoading(false));
    }, [url]);

    useEffect(() => {
        if (!filename || !media || (media.source === 'direct' && !media.isYouTube)) return;
        const base = filename.substring(0, filename.lastIndexOf('.')) || filename;
        const ext = isAudioOnly ? '.mp3' : '.mp4';
        if (!filename.endsWith(ext)) {
            setFilename(base + ext);
        }
    }, [isAudioOnly, media]);

    const copyUrl = () => {
        navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        toast.success("URL Copied to clipboard");
    };

    const pickFolder = async () => {
        if (electronAPI?.selectFolder) {
            const res = await electronAPI.selectFolder();
            if (res) setSavePath(res);
        } else {
            console.warn('[Dialog] selectFolder API not found');
        }
    };

    const selectedOption = displayOptions.find(
        q => (q.formatId || q.quality) === selectedQualityId
    ) || displayOptions[0];

    const handleConfirm = (mode: 'now' | 'later') => {
        if (mode === 'later') {
            if (!scheduledAt) {
                toast.error('Please set a schedule date/time first using the "Schedule Start" field above.');
                return;
            }
            const scheduledMs = new Date(scheduledAt).getTime();
            if (scheduledMs <= Date.now()) {
                toast.error('Scheduled time must be in the future.');
                return;
            }
        }

        onConfirm({
            filename,
            savePath,
            mode,
            priority: 'normal',
            scheduledAt: mode === 'later' ? scheduledAt : null,
            connections: isSpeedBoost ? 16 : 4,
            quality: selectedOption?.quality,
            formatId: selectedOption?.formatId,
            variantUrl: selectedOption?.url || url,
            type: media?.source || 'direct',
            isAudioOnly,
            status: mode === 'later' ? 'scheduled' : 'queued',
            headers: headers
        });

        if (mode === 'later') {
            setScheduledConfirmed(true);
        }
    };

    // ── Scheduled Confirmation Screen ───────────────────────────────────────
    if (scheduledConfirmed) {
        const scheduledDate = scheduledAt ? new Date(scheduledAt) : null;
        return (
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-[#0b0f1a] w-full h-full rounded-3xl overflow-hidden border border-white/10 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.7)] flex flex-col"
            >
                {/* Header */}
                <div style={{ WebkitAppRegion: 'drag' } as any} className="h-12 flex items-center px-4 shrink-0 border-b border-white/5 bg-[#0d1321]">
                    <div className="flex items-center gap-3">
                        <div className="bg-purple-600/20 p-2 rounded-xl border border-purple-500/20">
                            <Clock className="w-4 h-4 text-purple-400" />
                        </div>
                        <div>
                            <h2 className="text-sm font-bold text-white">Nexus Engine</h2>
                            <p className="text-[10px] text-purple-400 uppercase font-black tracking-widest opacity-70">Download Scheduled</p>
                        </div>
                    </div>
                    {/* macOS Window Controls - Moved to Right */}
                    <div className="flex gap-2 ml-auto" style={{ WebkitAppRegion: 'no-drag' } as any}>
                        <button onClick={() => electronAPI?.minimize?.()} className="w-3 h-3 rounded-full bg-[#febc2e] hover:bg-[#febc2ecc] border border-[#d8a120] transition-colors" title="Minimize" />
                        <button onClick={onCancel} className="w-3 h-3 rounded-full bg-[#ff5f57] hover:bg-[#ff5f57cc] border border-[#e0443e] transition-colors" title="Close" />
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-6">
                    <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ type: "spring", delay: 0.1 }}
                        className="w-20 h-20 rounded-2xl bg-purple-600/20 border border-purple-500/30 flex items-center justify-center"
                    >
                        <Clock className="w-10 h-10 text-purple-400" />
                    </motion.div>

                    <div className="text-center space-y-2">
                        <h3 className="text-xl font-black text-white">Download Scheduled!</h3>
                        <p className="text-white/50 text-sm">Your download has been queued and will start automatically.</p>
                    </div>

                    <div className="w-full bg-white/[0.03] border border-white/5 rounded-2xl p-5 space-y-3">
                        <div className="flex items-start gap-3">
                            <div className="text-[9px] text-white/30 uppercase font-black tracking-widest w-24 shrink-0 mt-0.5">File</div>
                            <p className="text-white text-sm font-bold truncate">{filename}</p>
                        </div>
                        <div className="h-px bg-white/5" />
                        <div className="flex items-center gap-3">
                            <div className="text-[9px] text-white/30 uppercase font-black tracking-widest w-24 shrink-0">Starts At</div>
                            <p className="text-purple-400 text-sm font-black">
                                {scheduledDate ? scheduledDate.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Unknown'}
                            </p>
                        </div>
                        <div className="h-px bg-white/5" />
                        <div className="flex items-center gap-3">
                            <div className="text-[9px] text-white/30 uppercase font-black tracking-widest w-24 shrink-0">Save To</div>
                            <p className="text-white/60 text-xs font-mono truncate">{savePath}</p>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 bg-[#0f172a] border-t border-white/5 flex gap-3 shrink-0">
                    <Button
                        className="flex-1 bg-purple-600 hover:bg-purple-500 text-white font-bold h-10 rounded-lg gap-2 shadow-lg transition-all text-xs"
                        onClick={onCancel}
                    >
                        <Check className="w-4 h-4" />
                        Done
                    </Button>
                </div>
            </motion.div>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-[#0b0f1a] w-full h-full rounded-3xl overflow-hidden border border-white/10 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.7)] flex flex-col"
        >

            {/* ── Header ────────────────────────────────────────────────────────── */}
            <div
                style={{ WebkitAppRegion: 'drag' } as any}
                className="h-10 flex items-center px-4 relative shrink-0 border-b border-white/5 bg-[#0d1321]"
            >
                <div className="flex items-center gap-3">
                    <div className="bg-blue-600/20 p-2 rounded-xl border border-blue-500/20">
                        {isLoading
                            ? <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
                            : <Download className="w-4 h-4 text-blue-400" />}
                    </div>
                    <div className="flex flex-col">
                        <h2 className="text-sm font-bold text-white tracking-wide">Nexus Manager</h2>
                        <p className="text-[10px] text-blue-400 uppercase font-black tracking-widest opacity-70">Intelligence Engine</p>
                    </div>
                </div>

                {/* macOS Window Controls - Moved to Far Right */}
                <div className="flex gap-2 ml-auto" style={{ WebkitAppRegion: 'no-drag' } as any}>
                    <button
                        onClick={() => electronAPI?.minimize()}
                        className="w-3 h-3 rounded-full bg-[#febc2e] hover:bg-[#febc2ecc] border border-[#d8a120] transition-colors"
                        title="Minimize"
                    />
                    <button
                        onClick={() => electronAPI?.closeDialog ? electronAPI.closeDialog() : onCancel()}
                        className="w-3 h-3 rounded-full bg-[#ff5f57] hover:bg-[#ff5f57cc] border border-[#e0443e] transition-colors"
                        title="Close"
                    />
                </div>
            </div>

            {/* ── Main Scrollable Content ────────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
                <div className="p-4 space-y-4">

                    {/* Top Section: Media Info + Source URL */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                        {/* Media Card */}
                        <div className="lg:col-span-12 flex gap-3 bg-white/[0.03] border border-white/5 rounded-lg p-3 shadow-lg relative overflow-hidden group hover:border-blue-500/20 transition-all">
                            <div className="absolute inset-0 bg-gradient-to-br from-blue-600/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

                            {/* Thumbnail */}
                            <div className="w-24 h-14 bg-black/40 rounded-md flex-shrink-0 overflow-hidden flex items-center justify-center border border-white/5 shadow-inner">
                                {media?.thumbnail
                                    ? <img src={media.thumbnail} alt="thumb" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                                    : isLoading
                                        ? <Loader2 className="w-6 h-6 text-blue-400/40 animate-spin" />
                                        : <Film className="w-6 h-6 text-blue-400/20" />}
                            </div>

                            <div className="flex-1 flex flex-col justify-center gap-1.5 min-w-0">
                                {isLoading ? (
                                    <div className="space-y-2">
                                        <div className="h-4 w-3/4 bg-white/5 rounded-lg animate-pulse" />
                                        <div className="h-3 w-1/2 bg-white/5 rounded-lg animate-pulse" />
                                    </div>
                                ) : (
                                    <>
                                        <p className="text-white font-black text-base leading-tight truncate">{media?.title || 'Resolving Media Title...'}</p>
                                        <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground font-bold tracking-tight">
                                            {media?.uploader && <span className="flex items-center gap-1"><Info className="w-2.5 h-2.5 text-blue-400" /> {media.uploader}</span>}
                                            {media?.durationFormatted && <span className="flex items-center gap-1"><Clock className="w-2.5 h-2.5 text-blue-400" /> {media.durationFormatted}</span>}
                                            {media?.source && <span className="bg-blue-600/20 text-blue-400 px-2 py-0.5 rounded text-[8px] uppercase font-black tracking-widest">{media.source}</span>}
                                            {media?.isLive && <span className="bg-red-600/20 text-red-400 px-2 py-0.5 rounded text-[8px] uppercase font-black tracking-widest animate-pulse">● LIVE</span>}
                                        </div>
                                        {analyzeError && <p className="text-red-400/80 text-[10px] font-bold">⚠ {analyzeError}</p>}
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Source URL with Copy */}
                        <div className="lg:col-span-12 space-y-1.5">
                            <Label className="text-[9px] text-white/40 uppercase font-black tracking-[0.2em] flex items-center gap-2 ml-1">
                                Source URL
                            </Label>
                            <div
                                onClick={copyUrl}
                                className="group relative cursor-pointer bg-black/40 border border-white/5 hover:border-blue-500/30 text-[10px] text-blue-400/80 font-mono p-3 rounded-xl shadow-inner transition-all flex items-center gap-3 overflow-hidden"
                            >
                                <div className="absolute inset-0 bg-blue-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                                <Link className="w-3.5 h-3.5 shrink-0 opacity-50 group-hover:opacity-100 transition-opacity" />
                                <span className="flex-1 truncate leading-relaxed">{url}</span>
                                {copied ? <Check className="w-3.5 h-3.5 text-green-400 shrink-0" /> : <div className="text-[9px] font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-all">Copy</div>}
                            </div>
                        </div>
                    </div>

                    {/* Middle Section: Filename + Save Path */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        {/* File Name */}
                        <div className="space-y-1">
                            <Label className="text-[8px] text-white/30 uppercase font-black tracking-[0.2em] flex items-center gap-2 ml-1">
                                File Name
                            </Label>
                            <Input
                                ref={fileNameRef}
                                value={filename}
                                onChange={(e) => setFilename(e.target.value)}
                                className="bg-white/[0.02] border-white/5 h-8 px-3 rounded-md text-white font-medium focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500/30 transition-all shadow-inner text-[11px]"
                                placeholder="Enter file name..."
                            />
                        </div>

                        {/* Save Path */}
                        <div className="space-y-1">
                            <Label className="text-[8px] text-white/30 uppercase font-black tracking-[0.2em] flex items-center gap-2 ml-1">
                                Save Destination
                            </Label>
                            <div className="flex gap-2">
                                <Input
                                    value={savePath}
                                    onChange={(e) => setSavePath(e.target.value)}
                                    className="bg-white/[0.02] border-white/5 h-8 flex-1 px-3 rounded-md text-white text-[10px] shadow-inner font-mono text-white/50"
                                    readOnly
                                />
                                <Button
                                    onClick={pickFolder}
                                    className="h-8 w-8 bg-white/5 border border-white/5 hover:bg-white/10 rounded-md transition-all flex-shrink-0 group"
                                >
                                    <FolderOpen className="w-3.5 h-3.5 text-white/40 group-hover:text-blue-400 transition-colors" />
                                </Button>
                            </div>
                        </div>
                    </div>

                    {/* Optional Section: Advanced Settings Toggle */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-end">
                        {/* Turbo */}
                        <div className="flex items-center justify-between bg-white/[0.02] p-2 rounded-lg border border-white/5 h-10 group hover:border-yellow-500/20 transition-all">
                            <div className="flex items-center gap-2">
                                <div className={`p-1 rounded-md transition-all ${isSpeedBoost ? 'bg-yellow-500/20 border border-yellow-500/30' : 'bg-white/5 border border-white/5'}`}>
                                    <Zap className={`w-3 h-3 ${isSpeedBoost ? 'text-yellow-500 fill-yellow-500/50' : 'text-muted-foreground'}`} />
                                </div>
                                <div className="flex flex-col">
                                    <span className={`text-[9px] font-black uppercase tracking-widest ${isSpeedBoost ? 'text-white' : 'text-muted-foreground'}`}>Turbo</span>
                                    <span className="text-[7px] text-muted-foreground font-bold">16 Parallel</span>
                                </div>
                            </div>
                            <Switch checked={isSpeedBoost} onCheckedChange={setIsSpeedBoost} className="data-[state=checked]:bg-blue-600 scale-[0.7]" />
                        </div>

                        {/* Schedule */}
                        <div className="space-y-1">
                            <Label className="text-[8px] text-white/40 uppercase font-black tracking-[0.2em] flex items-center gap-2 ml-1">
                                Schedule Start
                            </Label>
                            <div className="relative">
                                <Input
                                    type="datetime-local"
                                    value={scheduledAt}
                                    onChange={(e) => setScheduledAt(e.target.value)}
                                    className="bg-white/5 border-white/10 h-8 px-3 rounded-md text-white font-mono text-[10px] focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 transition-all [color-scheme:dark]"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Quality Selection: Modernized */}
                    {!media?.isPlaylist && (media?.source === 'ytdl' || media?.source === 'hls' || media?.source === 'dash' || media?.isYouTube) && (
                        <div className="space-y-3 pt-3 border-t border-white/5">
                            <div className="flex items-center justify-between mb-0.5">
                                <Label className="text-[8px] text-white/40 uppercase font-black tracking-[0.2em] ml-1">Format & Quality</Label>
                                <div className="flex bg-black/40 rounded-md border border-white/5 p-0.5">
                                    <button
                                        onClick={() => { setIsAudioOnly(false); setSelectedQualityId(''); }}
                                        className={`px-2 py-0.5 rounded text-[8px] font-black transition-all ${!isAudioOnly ? 'bg-blue-600 text-white shadow-md' : 'text-muted-foreground hover:text-white'}`}
                                    >VIDEO</button>
                                    <button
                                        onClick={() => { setIsAudioOnly(true); setSelectedQualityId(''); }}
                                        className={`px-2 py-0.5 rounded text-[8px] font-black transition-all ${isAudioOnly ? 'bg-purple-600 text-white shadow-md' : 'text-muted-foreground hover:text-white'}`}
                                    >AUDIO</button>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {isLoading ? (
                                    [1, 2, 4, 5].map(i => <div key={i} className="h-14 bg-white/5 rounded-xl animate-pulse" />)
                                ) : displayOptions.length > 0 ? (
                                    displayOptions.map((q, i) => {
                                        const qId = q.formatId || q.quality || String(i);
                                        const isSelected = selectedQualityId === qId || (!selectedQualityId && i === 0);
                                        return (
                                            <button
                                                key={qId}
                                                onClick={() => setSelectedQualityId(qId)}
                                                className={`group relative flex items-center justify-between p-2 rounded-lg border transition-all ${isSelected
                                                    ? isAudioOnly ? 'bg-purple-600/10 border-purple-500/40 text-white' : 'bg-blue-600/10 border-blue-500/40 text-white'
                                                    : 'bg-black/10 border-white/5 text-muted-foreground hover:border-white/10 hover:bg-white/[0.02]'
                                                    }`}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <div className={`w-6 h-6 rounded border flex items-center justify-center transition-all ${isSelected
                                                        ? isAudioOnly ? 'bg-purple-500 border-purple-400 scale-105' : 'bg-blue-500 border-blue-400 scale-105'
                                                        : 'border-white/10 group-hover:rotate-0'
                                                        }`}>
                                                        {isSelected ? <Check className="w-3 h-3 text-white" /> : (isAudioOnly ? <Music className="w-3 h-3" /> : <Film className="w-3 h-3" />)}
                                                    </div>
                                                    <div className="text-left">
                                                        <span className="font-black text-[10px] block leading-none mb-0.5">{q.label || q.quality}</span>
                                                        <div className="flex items-center gap-1 opacity-60">
                                                            {q.ext && <span className="text-[7px] uppercase font-black">{q.ext}</span>}
                                                            <span className="text-[7px] uppercase">•</span>
                                                            <span className="text-[7px] font-black">{q.filesize ? formatFileSize(q.filesize) : 'Size N/A'}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                                {q.height && (
                                                    <span className={`px-1.5 py-0.5 rounded font-black text-[7px] uppercase shadow-md ${q.height >= 2160 ? 'bg-yellow-500 text-black' :
                                                            q.height >= 1080 ? 'bg-blue-600 text-white' :
                                                                'bg-white/10 text-white'
                                                        }`}>
                                                        {q.height >= 2160 ? '4K' : q.height >= 1080 ? 'FHD' : q.height >= 720 ? 'HD' : q.height + 'P'}
                                                    </span>
                                                )}
                                            </button>
                                        );
                                    })
                                ) : (
                                    <div className="col-span-full h-20 flex flex-col items-center justify-center rounded-xl bg-black/20 border border-dashed border-white/10 gap-2 text-muted-foreground">
                                        <Radio className="w-5 h-5 opacity-20" />
                                        <p className="text-[10px] font-bold uppercase tracking-widest">{analyzeError ? 'Standard Stream' : 'Analyzing format options...'}</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Playlist Summary */}
                    {media?.isPlaylist && (
                        <div className="bg-gradient-to-r from-yellow-500/10 to-transparent border border-yellow-500/20 rounded-3xl p-6 flex items-center gap-6 shadow-2xl">
                            <div className="bg-yellow-500/20 p-4 rounded-2xl border border-yellow-500/20">
                                <List className="w-8 h-8 text-yellow-400" />
                            </div>
                            <div>
                                <h4 className="text-yellow-400 text-lg font-black tracking-tight leading-none mb-1">Playlist Queue</h4>
                                <p className="text-yellow-400/60 text-xs font-bold">{media.playlistCount} items will be processed sequentially</p>
                            </div>
                        </div>
                    )}

                </div>
            </div>

            {/* ── Action Footer ─────────────────────────────────────────────────── */}
            <div className="p-4 bg-[#0f172a] border-t border-white/5 flex gap-3 shrink-0 shadow-[0_-10px_30px_rgba(0,0,0,0.5)]">
                <Button
                    className="flex-[2] bg-blue-600 hover:bg-blue-500 text-white font-bold h-9 rounded-lg gap-2 shadow-lg transition-all active:scale-[0.98] text-[11px] group"
                    onClick={() => handleConfirm('now')}
                    disabled={isLoading}
                >
                    {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5 fill-white/10 group-hover:scale-110 transition-transform" />}
                    {media?.isPlaylist ? `PROCESS PLAYLIST (${media.playlistCount})` : 'DOWNLOAD NOW'}
                </Button>
                <Button
                    variant="secondary"
                    className="flex-1 bg-white/[0.03] hover:bg-white/[0.06] text-white/60 hover:text-white font-bold h-9 rounded-lg gap-2 px-4 border border-white/5 transition-all active:scale-[0.98] text-[10px] group"
                    onClick={() => handleConfirm('later')}
                >
                    <Clock className="w-3 h-3 opacity-40 group-hover:opacity-100 transition-all" />
                    LATER
                </Button>
            </div>
        </motion.div>
    );
}
