const EventEmitter = require('events');

/**
 * Phase 9: Smart Queue Manager
 * The "brain" of Nexus that orchestrates when and how downloads start.
 */
class QueueManager extends EventEmitter {
    constructor(downloadManager) {
        super();
        this.dm = downloadManager;

        // Internal state
        this.active = new Map();     // id -> task
        this.waiting = [];           // Sorted array of metadata { id, priority, createdAt }
        this.paused = new Map();     // id -> task (waiting to be resumed)
        this.scheduled = [];         // array of { id, scheduledAt }

        this.maxConcurrent = 5;
        this.maxRetries = 3;
        this.speedLimit = 0; // 0 = unlimited

        // Priority Map (lower index = higher priority)
        this.priorityWeight = {
            'high': 0,
            'normal': 1,
            'low': 2
        };

        // Start background processing
        this._startScheduler();
    }

    // Configure settings from DB
    updateSettings(settings) {
        if (settings.concurrentDownloads) this.maxConcurrent = settings.concurrentDownloads;
        if (settings.maxRetries) this.maxRetries = settings.maxRetries;
        if (settings.speedLimit !== undefined) {
            this.speedLimit = settings.speedLimit;
            // Apply to all active tasks
            for (const [id, task] of this.active) {
                if (task.throttle) task.throttle(this.getLimitPerTask());
            }
        }

        // Strict limit enforcement: if we now have MORE active than allowed, pause the extras
        if (this.active.size > this.maxConcurrent) {
            const toPause = Array.from(this.active.keys()).slice(this.maxConcurrent);
            console.log(`[QueueManager] Concurrency limit reduced. Pausing ${toPause.length} items.`);
            toPause.forEach(id => this.pause(id));
        }

        this.processQueue();
    }

    getLimitPerTask() {
        if (this.speedLimit <= 0) return 0;
        const count = Math.max(1, this.active.size);
        return Math.floor(this.speedLimit / count);
    }

    /**
     * Add a download to the queue system
     */
    enqueue(id, metadata = {}) {
        const { priority = 'normal', scheduledAt = null, status = 'queued' } = metadata;

        const entry = {
            id,
            priority: this.priorityWeight[priority] ?? 1,
            scheduledAt: scheduledAt ? new Date(scheduledAt).getTime() : null,
            createdAt: Date.now(),
            retryCount: metadata.retryCount || 0
        };

        const task = this.dm.tasks.get(id);
        if (status === 'scheduled' && entry.scheduledAt > Date.now()) {
            this.scheduled.push(entry);
            if (task) task.status = 'scheduled';
            console.log(`[Queue] Item ${id} scheduled for ${new Date(entry.scheduledAt).toISOString()}`);
        } else {
            this.waiting.push(entry);
            if (task) task.status = 'queued';
            this._sortWaiting();
            console.log(`[Queue] Item ${id} added to waiting list (Priority: ${priority})`);
        }

        // Immediately try to process in case slots are free or schedule is now
        this.processQueue();
    }

    /**
     * Main loop to move "waiting" -> "active"
     */
    processQueue() {
        // If we have available slots, start the next normal tasks
        while (this.active.size < this.maxConcurrent && this.waiting.length > 0) {
            const next = this.waiting.shift();
            const task = this.dm.tasks.get(next.id);

            if (!task) {
                console.warn(`[QueueManager] Task ${next.id} not found in DownloadManager, skipping.`);
                continue;
            }

            // Update status to 'downloading' and notify
            task.status = 'downloading';
            this.active.set(next.id, task);
            this.dm.emit('download', { id: next.id, event: 'started', payload: { size: task.size } });

            console.log(`[Queue] Starting download: ${next.id} (${this.active.size}/${this.maxConcurrent})`);

            // Wire up completion/error handlers
            this._attachTaskHandlers(task);

            // Start the task
            task.start().catch(err => {
                console.error(`[Queue] Start error for ${next.id}:`, err);
                this.active.delete(next.id);
                this.processQueue();
            });
        }
    }

    _attachTaskHandlers(task) {
        const onFinished = () => {
            task.status = 'completed';
            this.active.delete(task.id);

            // Broadcast the completed explicitly so the React UI transitions out of "downloading"
            this.dm.emit('download', {
                id: task.id,
                event: 'finished',
                payload: { status: 'completed', progress: 100 }
            });

            console.log(`[Queue] Finished: ${task.id}. Slots free: ${this.maxConcurrent - this.active.size}`);
            this.processQueue();
            task.removeListener('finished', onFinished);
            task.removeListener('error', onError);
        };

        const onError = (err) => {
            this.active.delete(task.id);

            // Automatic Retry Logic
            const currentRetries = task.retryCount || 0;
            if (currentRetries < this.maxRetries) {
                const nextCount = currentRetries + 1;
                const delay = Math.pow(2, nextCount) * 5000; // 10s, 20s, 40s...

                console.warn(`[Queue] ${task.id} failed. Retrying (${nextCount}/${this.maxRetries}) in ${delay / 1000}s...`);

                setTimeout(() => {
                    task.retryCount = nextCount;
                    this.enqueue(task.id, {
                        priority: Object.keys(this.priorityWeight).find(k => this.priorityWeight[k] === task.priority) || 'normal',
                        retryCount: nextCount
                    });
                }, delay);
            } else {
                console.error(`[Queue] ${task.id} failed after ${this.maxRetries} retries.`);
                this.processQueue();
            }

            task.removeListener('finished', onFinished);
            task.removeListener('error', onError);
        };

        task.removeAllListeners('finished');
        task.removeAllListeners('error');
        task.once('finished', onFinished);
        task.once('error', onError);
    }

    pause(id) {
        const task = this.active.get(id);
        if (task) {
            task.pause();
            this.active.delete(id);
            this.paused.set(id, task);
            this.processQueue();
        } else {
            // If it's in waiting, remove it
            this.waiting = this.waiting.filter(w => w.id !== id);
        }
    }

    resume(id) {
        const task = this.paused.get(id);
        if (task) {
            this.paused.delete(id);
            this.enqueue(id, { priority: task.priority || 'normal' });
        }
    }

    _sortWaiting() {
        this.waiting.sort((a, b) => {
            if (a.priority !== b.priority) return a.priority - b.priority;
            return a.createdAt - b.createdAt;
        });
    }

    /**
     * Scheduler: Checks every 60s for items ready to start
     */
    _startScheduler() {
        setInterval(() => {
            const now = Date.now();
            const ready = this.scheduled.filter(s => s.scheduledAt <= now);

            if (ready.length > 0) {
                console.log(`[Scheduler] ${ready.length} items ready to start.`);
                ready.forEach(item => {
                    this.scheduled = this.scheduled.filter(s => s.id !== item.id);
                    this.waiting.push({ ...item, scheduledAt: null });
                    const task = this.dm.tasks.get(item.id);
                    if (task) task.status = 'queued';
                });
                this._sortWaiting();
                this.processQueue();
            }
        }, 10000); // Check every 10 seconds for responsive scheduling
    }

    // Manual Reordering
    moveUp(id) {
        const idx = this.waiting.findIndex(w => w.id === id);
        if (idx > 0) {
            const item = this.waiting.splice(idx, 1)[0];
            this.waiting.splice(idx - 1, 0, item);
        }
    }

    moveDown(id) {
        const idx = this.waiting.findIndex(w => w.id === id);
        if (idx !== -1 && idx < this.waiting.length - 1) {
            const item = this.waiting.splice(idx, 1)[0];
            this.waiting.splice(idx + 1, 0, item);
        }
    }

    /**
     * Remove a task from all queue lists
     */
    remove(id) {
        console.log(`[Queue] Removing task from queue: ${id}`);

        // 1. If active, stop and delete
        if (this.active.has(id)) {
            const task = this.active.get(id);
            if (task.pause) task.pause();
            this.active.delete(id);
        }

        // 2. Remove from waiting, paused, scheduled
        this.waiting = this.waiting.filter(w => w.id !== id);
        this.paused.delete(id);
        this.scheduled = this.scheduled.filter(s => s.id !== id);

        // 3. Process next to fill the slot
        this.processQueue();
    }
}

module.exports = { QueueManager };
