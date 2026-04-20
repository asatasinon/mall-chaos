package com.castrel.chaos.runner.model;

import java.util.List;

public record MemoryPressureRequest(List<String> targetServices, int bufferSizeKb) {}
