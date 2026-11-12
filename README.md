<img src="assets/icon.svg" width="64" height="64" alt="">

# zugferd-viewer

Öffnet ZUGFeRD-, Factur-X- und XRechnung-Dateien (PDF oder XML). Links steht die PDF, daneben das eingebettete XML als aufbereitete Rechnung oder im Rohformat, rechts das Prüfergebnis mit den betroffenen BT-Codes.

## Starten

```sh
docker compose up -d --build
```

Danach läuft die App auf http://localhost:3000.

Für die Entwicklung reicht der Validator im Container, die App läuft lokal:

```sh
docker compose up -d validator
pnpm install
pnpm dev
```

`VALIDATOR_URL` zeigt auf den Validator, Standard ist `http://localhost:8080`.

## Prüfung

Die App prüft nicht selbst. Sie schickt die Datei an [Mustang](https://www.mustangproject.org/) (`validator/`), den Open-Source-Validator für ZUGFeRD. Mustang prüft

- die PDF mit veraPDF auf PDF/A-3,
- das XML gegen das XSD des Profils,
- das XML gegen die offiziellen Schematron-Regeln: EN 16931 (CEN), die Factur-X/ZUGFeRD-Profile und XRechnung (KoSIT).

Als E-Rechnung im Sinne von § 14 UStG zeigt die App eine Datei nur an, wenn sie gültig ist und ein Profil nutzt, das EN 16931 abdeckt (BASIC, EN 16931, EXTENDED, XRechnung). MINIMUM und BASIC WL sind gültiges ZUGFeRD, aber keine Rechnung.

Die Mustang-Version steht in `validator/Dockerfile` (`MUSTANG_VERSION`). Neue Regelstände kommen mit einer neuen Mustang-Version.

## BT-Codes

`src/lib/bt-map.json` ordnet jedem CII-Element seinen Business Term (BT) oder seine Gruppe (BG) aus EN 16931 zu, samt deutschem Namen. Die Datei entsteht aus der [XRechnung-Visualisierung der KoSIT](https://github.com/itplr-kosit/xrechnung-visualization):

```sh
node scripts/generate-bt-map.mjs <entpacktes Release>
```

Die meisten Regeltexte nennen ihre BT-Codes selbst. Wo sie fehlen, etwa bei „Element 'ram:ID' must occur exactly 1 times“, schlägt die App den gemeldeten XML-Pfad in dieser Zuordnung nach.

## Daten

Es gibt keine Datenbank. Dateien bleiben im Browser und gehen nur zur Prüfung an den Validator, der nichts speichert.
