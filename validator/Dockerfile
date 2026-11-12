FROM eclipse-temurin:21-jdk AS build
ARG MUSTANG_VERSION=2.26.0
WORKDIR /app
ADD --chmod=644 https://repo1.maven.org/maven2/org/mustangproject/Mustang-CLI/${MUSTANG_VERSION}/Mustang-CLI-${MUSTANG_VERSION}.jar mustang.jar
COPY Server.java .
RUN javac -cp mustang.jar -d classes Server.java

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /app/mustang.jar /app/mustang.jar
COPY --from=build /app/classes /app/classes
ENV PORT=8080
EXPOSE 8080
USER 1000
CMD ["java", "-cp", "/app/classes:/app/mustang.jar", "Server"]
