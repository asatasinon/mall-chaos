package com.castrel.chaos.common.chaos;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Simulates an unbounded in-process query-result cache — a common real-world
 * memory leak pattern where per-request results are cached without any eviction
 * policy or TTL, causing heap to grow indefinitely under sustained traffic.
 * <p>
 * start()  — begins accumulating cache entries in the background.
 * stop()   — halts further accumulation but retains held references (leak persists).
 * clear()  — releases all references so the next GC cycle can reclaim the heap.
 */
public class MemoryLeakChaosService {

    // Simulates an order-list query result cache keyed by userId + request timestamp.
    // Entries are added without expiry or size limit — the missing eviction policy
    // is the simulated bug.
    private final Map<String, byte[]> orderResultCache = new ConcurrentHashMap<>();
    // Insertion-ordered key registry used for deterministic bulk-clear
    private final List<String> cacheKeyRegistry = new ArrayList<>();

    private final AtomicBoolean running = new AtomicBoolean(false);
    private final AtomicLong holdingBytes = new AtomicLong(0);
    private final ScheduledExecutorService scheduler =
            Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "order-cache-loader");
                t.setDaemon(true);
                return t;
            });
    private Future<?> task;

    private volatile int chunkSizeKb = 1024;
    private volatile long intervalMs = 500;
    private volatile int maxMb = 512;

    /** Start with default parameters (1 MB chunks, 500 ms interval, 512 MB cap). */
    public synchronized void start() {
        start(1024, 500, 512);
    }

    /**
     * Start the memory leak simulation.
     *
     * @param chunkSizeKb size of each simulated cache entry in KB
     * @param intervalMs  time between cache insertions in milliseconds
     * @param maxMb       maximum total holding size in MB; stops inserting when reached
     */
    public synchronized void start(int chunkSizeKb, long intervalMs, int maxMb) {
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

            // Each entry simulates a serialised order-list result cached by userId.
            // The cache key encodes userId + epoch-ms so it is always unique —
            // no existing entry is ever replaced, only new ones are added.
            long userId = ThreadLocalRandom.current().nextLong(1, 10_001);
            String cacheKey = "order-list:" + userId + ":" + System.currentTimeMillis();
            byte[] payload = new byte[chunkBytes];
            // Stamp lightweight metadata so entries are not pure zero-filled
            payload[0] = (byte) (userId & 0xFF);
            payload[1] = (byte) (System.currentTimeMillis() & 0xFF);

            synchronized (cacheKeyRegistry) {
                orderResultCache.put(cacheKey, payload);
                cacheKeyRegistry.add(cacheKey);
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
        synchronized (cacheKeyRegistry) {
            orderResultCache.clear();
            cacheKeyRegistry.clear();
        }
        holdingBytes.set(0);
        System.gc();
    }

    public boolean isRunning() { return running.get(); }
    public long getHoldingMb() { return holdingBytes.get() / (1024 * 1024); }
    public int getObjectCount() { synchronized (cacheKeyRegistry) { return orderResultCache.size(); } }
    public int getChunkSizeKb() { return chunkSizeKb; }
    public long getIntervalMs() { return intervalMs; }
    public int getMaxMb() { return maxMb; }
}
