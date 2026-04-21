FROM alpine:3.20 AS javaagent-extractor
WORKDIR /opt/agent
COPY assets/JavaAgent.zip JavaAgent.zip
RUN apk add --no-cache unzip \
	&& unzip -q JavaAgent.zip \
	&& rm -f JavaAgent.zip

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY assets/opentelemetry-javaagent.jar /app/opentelemetry-javaagent.jar
COPY --from=javaagent-extractor /opt/agent/JavaAgent /data/app/JavaAgent
COPY payment-service/target/*.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]
