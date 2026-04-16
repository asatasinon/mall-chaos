package com.castrel.chaos.runner;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class TrafficRunnerApplication {
    public static void main(String[] args) {
        SpringApplication.run(TrafficRunnerApplication.class, args);
    }
}
