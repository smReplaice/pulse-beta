FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /src
COPY pom.xml .
RUN mvn -q dependency:go-offline
COPY src ./src
RUN mvn -q package -DskipTests

FROM eclipse-temurin:17-jre-alpine
WORKDIR /app
COPY --from=build /src/target/mpxj-converter-1.0.0.jar app.jar
# Operational limits: 1GB heap, 300s hard timeout per request handled by
# spring's async + the Pulse client's own 60s abort.
ENV JAVA_OPTS="-Xmx1g"
EXPOSE 8080
USER nobody
ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
