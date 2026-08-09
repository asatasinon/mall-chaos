ARG BASE_IMAGE_REGISTRY=harbor.cloudwise.com/noname/
FROM ${BASE_IMAGE_REGISTRY}alpine:3.20 AS javaagent-extractor
WORKDIR /opt/agent
COPY assets/JavaAgent.zip JavaAgent.zip
RUN apk add --no-cache unzip \
	&& unzip -q JavaAgent.zip \
	&& rm -f JavaAgent.zip

FROM ${BASE_IMAGE_REGISTRY}apache/skywalking-java-agent:9.4.0-java21 AS sw-agent

FROM ${BASE_IMAGE_REGISTRY}eclipse-temurin:21-jdk-alpine
WORKDIR /app
COPY assets/opentelemetry-javaagent.jar /app/opentelemetry-javaagent.jar
COPY --from=sw-agent /skywalking/agent /app/skywalking-agent
COPY --from=javaagent-extractor /opt/agent/JavaAgent /data/app/JavaAgent
COPY scripts/java-service-entrypoint.sh /app/entrypoint.sh
COPY user-service/target/*.jar app.jar
RUN chmod +x /app/entrypoint.sh
ENTRYPOINT ["/app/entrypoint.sh"]
