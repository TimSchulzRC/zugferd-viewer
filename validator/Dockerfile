FROM eclipse-temurin:21-jdk AS build
ARG MUSTANG_VERSION=2.26.0
# phive-rules-peppol ships the Peppol BIS Billing Schematron compiled to XSLT. Release 2026.11 (BIS 3.1.0)
# is the first with the Slovak rules SK-R-001 to SK-R-007.
ARG PHIVE_PEPPOL_VERSION=4.7.3
ARG PEPPOL_RULES=external/schematron/openpeppol/2026.11/xslt
WORKDIR /app
ADD --chmod=644 https://repo1.maven.org/maven2/org/mustangproject/Mustang-CLI/${MUSTANG_VERSION}/Mustang-CLI-${MUSTANG_VERSION}.jar mustang.jar
ADD --chmod=644 https://repo1.maven.org/maven2/com/helger/phive/rules/phive-rules-peppol/${PHIVE_PEPPOL_VERSION}/phive-rules-peppol-${PHIVE_PEPPOL_VERSION}.jar peppol.jar
RUN jar xf peppol.jar ${PEPPOL_RULES}/PEPPOL-EN16931-UBL.xslt ${PEPPOL_RULES}/PEPPOL-EN16931-UBL-SB.xslt \
  && mkdir rules && mv ${PEPPOL_RULES}/*.xslt rules/
COPY Server.java .
RUN javac -cp mustang.jar -d classes Server.java

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /app/mustang.jar /app/mustang.jar
COPY --from=build /app/classes /app/classes
COPY --from=build /app/rules /app/rules
ENV PORT=8080
EXPOSE 8080
USER 1000
CMD ["java", "-cp", "/app/classes:/app/mustang.jar", "Server"]
