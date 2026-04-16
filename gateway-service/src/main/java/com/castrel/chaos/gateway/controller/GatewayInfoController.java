package com.castrel.chaos.gateway.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.cloud.gateway.route.RouteLocator;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Flux;

import java.util.Map;

@RestController
public class GatewayInfoController {

    @Autowired
    private RouteLocator routeLocator;

    @GetMapping("/internal/gateway/routes")
    public Flux<Map<String, String>> routes() {
        return routeLocator.getRoutes().map(route -> Map.of(
                "id", route.getId(),
                "uri", route.getUri().toString(),
                "predicate", route.getPredicate().toString()
        ));
    }
}
