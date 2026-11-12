<img src="assets/icon.svg" width="64" height="64" alt="">

# zugferd-viewer

Ablage und Prüfung für ZUGFeRD-, Factur-X- und XRechnung-Dateien (PDF oder XML).

- **Dateimanager.** Ordner in beliebiger Tiefe, Hochladen per Drag-and-drop (auch ganze Ordner), Umbenennen, Verschieben, Löschen, Mehrfachauswahl, Download einzeln oder als Zip. Rechtsklick öffnet das Kontextmenü.
- **Viewer.** Links die PDF, daneben das eingebettete XML als aufbereitete Rechnung oder im Rohformat, rechts das Prüfergebnis mit den betroffenen BT-Codes. Ein Klick auf einen Befund markiert die Stelle im XML.
- **Nutzer.** Anmeldung per E-Mail-Code oder Microsoft. Wer sich anmelden darf, bestimmen Administratoren per Einladung.

## Aufbau

| Dienst | Aufgabe |
| --- | --- |
| `web` | Next.js-App mit Better Auth |
| `validator` | Mustang als kleiner HTTP-Dienst (`validator/`) |
| `postgres` | Nutzer, Sitzungen, Ordnerbaum, Prüfergebnisse |
| S3 (extern) | die Dateien selbst |

Der Ordnerbaum liegt in Postgres, in S3 liegt jede Datei unter einem zufälligen Schlüssel (`files/<uuid>`). Umbenennen und Verschieben ändern deshalb nur eine Zeile in der Datenbank. Alle Nutzer sehen dieselbe Ablage.

Das Datenbankschema legt die App beim ersten Aufruf selbst an.

## Betrieb mit Coolify

`compose.yaml` ist für Coolify geschrieben (Build Pack „Docker Compose“). Kein Dienst veröffentlicht einen Port, der Proxy erreicht `web` über das Docker-Netz auf Port 3000. Domain für `web` in Coolify setzen, die Variablen unten eintragen, deployen.

Coolify erzeugt selbst: die öffentliche URL (`SERVICE_URL_WEB`), das Datenbankpasswort und das Auth-Secret.

| Variable | Pflicht | Bedeutung |
| --- | --- | --- |
| `ADMIN_EMAIL` | ja | Erster Administrator. Diese Adresse kann sich immer anmelden und andere einladen. |
| `S3_ENDPOINT` | ja | z. B. `https://s3.example.com`, ohne Schema gilt https |
| `S3_BUCKET` | ja | Der Bucket muss existieren. |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | ja | |
| `S3_REGION` | nein | Standard `us-east-1`, bei Hetzner der Standort aus dem Endpunkt |
| `PUBLIC_URL` | nein | Nur bei mehreren Domains: die Adresse, über die Nutzer die App öffnen |
| `LETTERMINT_TOKEN` | ja | Sending-Token des Lettermint-Projekts |
| `MAIL_FROM` | ja | z. B. `ZUGFeRD Viewer <rechnungen@example.com>`, die Domain muss bei Lettermint verifiziert sein |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID` | nein | Schaltet „Mit Microsoft anmelden“ frei, sobald alle drei gesetzt sind |

### Microsoft-Anmeldung

In Entra ID eine App-Registrierung für **einen Mandanten** anlegen, Redirect-URI `https://<domain>/api/auth/callback/microsoft`. `MICROSOFT_TENANT_ID` muss die ID des eigenen Mandanten sein. `common` lehnt die App ab: Einladungen gelten für eine E-Mail-Adresse, und bei einer mandantenübergreifenden App könnte jeder fremde Mandant ein Konto mit dieser Adresse anlegen.

Auch über Microsoft kommt nur herein, wer eingeladen ist.

## Entwicklung

```sh
docker compose -f compose.dev.yaml up -d   # Validator, Postgres, S3-Ersatz (S3Mock)
cp .env.example .env.local                  # BETTER_AUTH_SECRET und ADMIN_EMAIL eintragen
pnpm install
pnpm dev
```

Ohne `LETTERMINT_TOKEN` verschickt die App keine Mails, sondern schreibt sie ins Server-Log. Dort steht dann auch der Anmeldecode. S3Mock vergisst seine Dateien beim Neustart.

## Prüfung

Die App prüft nicht selbst. Beim Hochladen schickt sie die Datei an [Mustang](https://www.mustangproject.org/), den Open-Source-Validator für ZUGFeRD, und speichert dessen Ergebnis. Mustang prüft

- die PDF mit veraPDF auf PDF/A-3,
- das XML gegen das XSD des Profils,
- das XML gegen die offiziellen Schematron-Regeln: EN 16931 (CEN), die Factur-X/ZUGFeRD-Profile und XRechnung (KoSIT).

Als E-Rechnung im Sinne von § 14 UStG zeigt die App eine Datei nur an, wenn sie gültig ist und ein Profil nutzt, das EN 16931 abdeckt (BASIC, EN 16931, EXTENDED, XRechnung). MINIMUM und BASIC WL sind gültiges ZUGFeRD, aber keine Rechnung.

Die Mustang-Version steht in `validator/Dockerfile` (`MUSTANG_VERSION`). Neue Regelstände kommen mit einer neuen Mustang-Version. „Erneut prüfen“ im Viewer prüft eine gespeicherte Datei mit dem aktuellen Stand.

## BT-Codes

`src/lib/bt-map.json` ordnet jedem CII-Element seinen Business Term (BT) oder seine Gruppe (BG) aus EN 16931 zu, samt deutschem Namen. Die Datei entsteht aus der [XRechnung-Visualisierung der KoSIT](https://github.com/itplr-kosit/xrechnung-visualization):

```sh
node scripts/generate-bt-map.mjs <entpacktes Release>
```

Die meisten Regeltexte nennen ihre BT-Codes selbst. Wo sie fehlen, etwa bei „Element 'ram:ID' must occur exactly 1 times“, schlägt die App den gemeldeten XML-Pfad in dieser Zuordnung nach.
