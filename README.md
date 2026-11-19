<img src="src/app/icon.svg" width="64" height="64" alt="">

# zugferd-viewer

Ablage und Prüfung für ZUGFeRD-, Factur-X- und XRechnung-Dateien (PDF oder XML).

- **Dateimanager.** Ordner in beliebiger Tiefe, Hochladen per Drag-and-drop (auch ganze Ordner), Umbenennen, Verschieben, Löschen, Mehrfachauswahl, Download einzeln oder als Zip. Rechtsklick öffnet das Kontextmenü.
- **Viewer.** Links die PDF, daneben das eingebettete XML als aufbereitete Rechnung oder im Rohformat, rechts das Prüfergebnis mit den betroffenen BT-Codes. Ein Klick auf einen Befund markiert die Stelle im XML.
- **IDocs und andere Textdateien.** Neben Rechnungen nimmt die Ablage jede Textdatei an, etwa die Quellnachricht, aus der ein Mapping die Rechnung erzeugt hat. Siehe unten.
- **Nutzer.** Anmeldung per E-Mail-Code oder Microsoft. Wer sich anmelden darf, bestimmen Administratoren per Einladung.
- **Eigene Ablage.** Jeder Nutzer sieht nur seine eigenen Ordner und Dateien. Teilen lässt sich mit allen Nutzern oder ausgewählten, zum Ansehen oder Bearbeiten. Siehe unten.
- **Teilen mit Externen.** Ordner oder einzelne Dateien für eine Person außerhalb freigeben, wahlweise mit Ablaufdatum. In einen geteilten Ordner darf sie auf Wunsch auch hochladen. Siehe unten.

## Aufbau

| Dienst | Aufgabe |
| --- | --- |
| `web` | Next.js-App mit Better Auth |
| `validator` | Mustang als kleiner HTTP-Dienst (`validator/`) |
| `postgres` | Nutzer, Sitzungen, Ordnerbaum, Prüfergebnisse |
| S3 (extern) | die Dateien selbst |

Der Ordnerbaum liegt in Postgres, in S3 liegt jede Datei unter einem zufälligen Schlüssel (`files/<uuid>`). Umbenennen und Verschieben ändern deshalb nur eine Zeile in der Datenbank.

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

## Eigene Ablage und Teilen im Team

Jeder Ordner und jede Datei gehört einer Person, nämlich der, der der oberste Ordner gehört. Andere sehen davon nichts, auch Administratoren nicht. Wer eine fremde ID errät, bekommt 404.

Rechtsklick, „Teilen“, oben „Mit Nutzern dieser App teilen“: „Alle Nutzer“ oder eine Person wählen, dazu „Ansehen“ oder „Bearbeiten“. Eine Freigabe auf einem Ordner gilt für alles darin.

| | Ansehen | Bearbeiten | Besitzer |
| --- | --- | --- | --- |
| Öffnen, herunterladen | ja | ja | ja |
| Hochladen, Ordner anlegen, darin umbenennen, verschieben, löschen, erneut prüfen | | ja | ja |
| Den geteilten Ordner selbst umbenennen, verschieben oder löschen | | | ja |
| Weiter teilen, intern oder per Link | | | ja |

- Geteiltes erscheint bei den anderen oben in „Rechnungen“, mit der Adresse der Besitzerin daneben. Was jemand in einen fremden Ordner hochlädt, gehört der Besitzerin des Ordners.
- Verschieben geht nur innerhalb derselben Ablage. Wer etwas in einen fremden Ordner bringen will, lädt es dort hoch.
- Entfernt ein Admin einen Nutzer, gehen dessen Ordner und Dateien an den Admin, in einen Ordner „Von <adresse>“. Freigaben, die der Nutzer gemacht hat, bleiben bestehen.
- Beim Update auf diese Version gehört jeder vorhandene oberste Ordner samt Inhalt dem, der ihn angelegt hat (sonst `ADMIN_EMAIL`), und bleibt für alle zum Bearbeiten freigegeben. Was jemand in einen fremden Ordner geladen hatte, gehört wie bei neuen Dateien der Besitzerin des Ordners. So verliert niemand den Zugriff. Wer seinen Ordner für sich haben will, entfernt im Teilen-Dialog die Zeile „Alle Nutzer“.

### Selbst prüfen

Bei laufendem `pnpm dev` (ohne `LETTERMINT_TOKEN`, damit jeder Anmeldecode `000000` ist):

```sh
pnpm test:access                    # Adresse aus .env.local (PUBLIC_URL, sonst APP_URL)
pnpm test:access http://host:3001   # oder ausdrücklich
```

Das Skript lädt die Demo-Nutzer `anna@demo.test`, `ben@demo.test` und `carla@demo.test` ein, baut über die echte API ein Szenario auf (privat, für alle zum Ansehen, für Ben zum Bearbeiten) und prüft gut 100 Fälle: wer was sieht, wer was ändern darf, fremde IDs, Ändern und Entfernen von Freigaben, Hochladen über einen Link, Übergabe beim Löschen eines Nutzers. Danach bleibt das Szenario stehen; das Skript nennt am Ende, was jede Person beim Durchklicken sehen sollte. Jeder Lauf räumt die Demo-Daten des letzten Laufs vorher ab.

## IDocs und andere Textdateien

Was eine Datei ist, liest die App aus dem Inhalt, nicht aus der Endung. IDocs kommen als `.txt`, `.idoc`, `.dat` oder ganz ohne Endung. Geprüft werden nur Rechnungen (PDF, CII- und UBL-XML). Binärdateien außer PDF lehnt der Upload ab.

| Erkannt als | Ansicht |
| --- | --- |
| IDoc (Flatfile oder XML) | Aufbereitet nach Segmenten, oder roh |
| EDIFACT | Ein Segment je Zeile |
| JSON | Eingerückt |
| CSV | Als Tabelle, oder roh mit Spalten in wechselnden Farben |
| XML, das keine Rechnung ist | Eingerückt |
| Alles andere | Text |

Ein Flatfile-IDoc hat keine Trennzeichen, jedes Feld steht an einer festen Stelle seines Segments. Die Feldlängen der Segmente von INVOIC02 stehen in `src/lib/idoc-segments.json`, die deutschen Namen in `src/lib/idoc-terms.ts`. Die Rohansicht färbt die Felder abwechselnd ein und nennt beim Überfahren den Feldnamen. Kundeneigene Segmente (`Z…`) zeigt die App ungeteilt.

Weitere IDoc-Typen kommen aus einer BIC-Nachrichtenbeschreibung des Mapping Designers dazu:

```sh
node scripts/generate-idoc-segments.mjs msg_INVOIC02.xml msg_DESADV.xml
```

Das Skript schreibt die Datei neu, also immer alle Beschreibungen angeben.

## Teilen mit Externen

Rechtsklick auf einen Ordner oder eine Datei, „Teilen“, E-Mail-Adresse eintragen. Die Person bekommt einen Link per Mail. Öffnet sie ihn, schickt die App einen sechsstelligen Code an genau diese Adresse; erst der Code schaltet den Link in diesem Browser für 24 Stunden frei. Ein weitergeleiteter Link nützt deshalb niemandem ohne Zugriff auf das Postfach.

- Links verschicken kann nur, wem der Ordner oder die Datei gehört.
- Externe können ansehen (PDF, Rechnungsdaten, Prüfergebnis) und herunterladen. Ändern, verschieben, löschen, erneut prüfen oder weiter teilen können sie nichts; sie haben kein Konto und erreichen keine andere API als `/api/s/<token>`.
- Bei einem Link auf einen Ordner lässt sich im Teilen-Dialog jederzeit „Darf Dateien hochladen“ an- und ausschalten. Dann lädt die Person Dateien in den Ordner und seine Unterordner. Sie gehören der Besitzerin des Ordners und werden wie jeder Upload geprüft. Vorhandenes ersetzt sie nie (gleicher Name wird „Name (2)“), Ordner legt sie keine an. Was ein Link in den letzten 24 Stunden hochgeladen hat und noch da ist, darf höchstens 200 Dateien und 1 GB ausmachen; das begrenzt den Speicher, den ein Link füllen kann. Pro Link laufen höchstens 3 Uploads gleichzeitig.
- Ein Link sieht nur den freigegebenen Ordner und was darin liegt. Ein Link-Symbol in der Dateiliste zeigt, was geteilt ist, ein Klick darauf öffnet die Liste der Freigaben. Löschen beendet den Zugriff sofort.
- Codes gelten 10 Minuten, einmal, mit höchstens 5 Versuchen; ein neuer Code geht frühestens nach einer Minute raus. Die Datenbank speichert Codes und Sitzungen nur als HMAC mit `BETTER_AUTH_SECRET`.
- Was heruntergeladen ist, kann die Person natürlich weitergeben. Das verhindert keine Software.


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
