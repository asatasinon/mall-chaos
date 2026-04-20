package com.castrel.chaos.runner.model;

import java.util.List;

public record SlowQueryRequest(String joinTable, List<String> targetServices) {}
