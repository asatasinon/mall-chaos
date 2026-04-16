package com.castrel.chaos.common;

/**
 * Defines the blast radius of a chaos injection.
 * ALL  — apply to every request / row.
 * PARTIAL — apply to a configurable percentage of requests / rows.
 */
public enum ChaosScope {
    ALL,
    PARTIAL
}
