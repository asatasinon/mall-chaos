ARG BASE_IMAGE_REGISTRY=harbor.cloudwise.com/noname/
# Set to "disabled" (e.g. --build-arg SKYWALKING_MODE=disabled) to skip pulling the
# SkyWalking agent image entirely, e.g. when it isn't mirrored in an internal registry.
# TRACING_MODE defaults to otel-only at runtime, so skipping it has no functional impact.
ARG SKYWALKING_MODE=enabled

FROM ${BASE_IMAGE_REGISTRY}alpine:3.20 AS javaagent-extractor
WORKDIR /opt/agent
COPY assets/JavaAgent.zip JavaAgent.zip
RUN apk add --no-cache unzip \
	&& unzip -q JavaAgent.zip \
	&& rm -f JavaAgent.zip

FROM ${BASE_IMAGE_REGISTRY}alpine:3.20 AS sw-agent-disabled
RUN mkdir -p /skywalking/agent

FROM ${BASE_IMAGE_REGISTRY}apache/skywalking-java-agent:9.4.0-java21 AS sw-agent-enabled

FROM sw-agent-${SKYWALKING_MODE} AS sw-agent

FROM ${BASE_IMAGE_REGISTRY}eclipse-temurin:21-jdk-alpine
WORKDIR /app
COPY assets/opentelemetry-javaagent.jar /app/opentelemetry-javaagent.jar
COPY --from=sw-agent /skywalking/agent /app/skywalking-agent
COPY --from=javaagent-extractor /opt/agent/JavaAgent /data/app/JavaAgent
COPY scripts/java-service-entrypoint.sh /app/entrypoint.sh
COPY gateway-service/target/*.jar app.jar
RUN chmod +x /app/entrypoint.sh
ENTRYPOINT ["/app/entrypoint.sh"]
