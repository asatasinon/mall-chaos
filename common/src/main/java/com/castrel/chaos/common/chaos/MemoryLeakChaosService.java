package com.castrel.chaos.common.chaos;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

/**
 * JVM heap memory leak simulation.
 * start(chunkSizeKb, intervalMs, maxMb) — spawns a background thread allocating byte[] chunks.
 * stop()  — stops allocation but retains held references.
 * clear() — releases all references so GC can reclaim memory.
 */
public class MemoryLeakChaosService {

    private final List<byte[]> leak = new ArrayList<>();
    private final AtomicBoolean running = new AtomicBoolean(false);
    private final AtomicLong holdingBytes = new AtomicLong(0);
    private final ScheduledExecutorService scheduler =
            Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "memory-leak-chaos");
                t.setDaemon(true);
                return t;
            });
    private Future<?> task;

    // Current config (readable for status endpoint)
    private volatile int chunkSizeKb = 1024;
    private volatile long intervalMs = 500;
    private volatile int maxMb = 512;

    /** Start with default parameters (1 MB chunks, 500 ms interval, 512 MB cap). */
    public synchronized void start() {
        start(1024, 500, 512);
    }

    /**
     * Start memory leak simulation.
     *
     * @param chunkSizeKb size of each allocation chunk in KB
     * @param intervalMs  time between allocations in milliseconds
     * @param maxMb       maximum total holding size in MB; stops allocating when reached
     */
    public synchronized void start(int chunkSizeKb, long intervalMs, int maxMb) {
        // Stop any previous run first
        if (running.get()) {
            running.set(false);
            if (task != null) task.cancel(false);
        }
        this.chunkSizeKb = chunkSizeKb;
        this.intervalMs = intervalMs;
        this.maxMb = maxMb;
        running.set(true);
        int chunkBytes = chunkSizeKb * 1024;
        long maxBytes = (long) maxMb * 1024 * 1024;
        task = scheduler.scheduleAtFixedRate(() -> {
            if (!running.get()) return;
            if (holdingBytes.get() >= maxBytes) return;
            byte[] chunk = new byte[chunkBytes];
            synchronized (leak) {
                leak.add(chunk);
            }
            holdingBytes.addAndGet(chunkBytes);
        }, 0, intervalMs, TimeUnit.MILLISECONDS);
    }

    public void stop() {
        running.set(false);
        if (task != null) task.cancel(false);
    }

    public synchronized void clear() {
        stop();
        synchronized (leak) {
            leak.clear();
        }
        holdingBytes.set(0);
        System.gc();
    }

    public boolean isRunning() { return running.get(); }
    public long getHoldingMb() { return holdingBytes.get() / (1024 * 1024); }
    public int getObjectCount() { synchronized (leak) { return leak.size(); } }
    public int getChunkSizeKb() { return chunkSizeKb; }
    public long getIntervalMs() { return intervalMs; }
    public int getMaxMb() { return maxMb; }
}
