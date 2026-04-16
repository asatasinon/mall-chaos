FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY assets/opentelemetry-javaagent.jar /app/opentelemetry-javaagent.jar
COPY gateway-service/target/*.jar app.jar
ENTRYPOINT ["java", "-javaagent:/app/opentelemetry-javaagent.jar", "-jar", "app.jar"]
