package com.castrel.chaos.runner.model;

import java.util.List;

public record TableLockRequest(String targetTable, String targetService, int durationSec) {}
