ARG BASE_IMAGE_REGISTRY=harbor.cloudwise.com/noname/
FROM ${BASE_IMAGE_REGISTRY}eclipse-temurin:21-jdk-alpine
WORKDIR /app
COPY psp-simulator/target/*.jar app.jar
ENTRYPOINT ["java", "-Duser.timezone=Asia/Shanghai", "-jar", "/app/app.jar"]
