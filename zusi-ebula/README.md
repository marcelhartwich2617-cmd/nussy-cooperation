# Nussy EBuLa – Fahrplananzeige für Zusi 3 Hobby

Ein elektronischer Buchfahrplan (EBuLa) für **Zusi 3**, der im Browser läuft: auf dem iPad, einem Tablet,
einem zweiten Monitor oder direkt auf dem Zusi-PC. Das Gerät ist dem echten EBuLa-Bordgerät nachempfunden,
mit allen Tasten rund um den Bildschirm.

```
Zusi 3 (TCP-Server, Port 1436) ──► bridge.js (Node.js) ──► Browser / iPad (http://<PC-IP>:8080)
```

## Funktionen

- **Live-Daten aus Zusi 3**: Geschwindigkeit, Uhrzeit und Datum, Kilometrierung, Streckenhöchstgeschwindigkeit und Zugnummer
- **Buchfahrplan automatisch von Zusi**: Zusi schickt den Buchfahrplan als XML. Fehlt er, liest die Bridge die passende
  `*.timetable.xml` neben der `.trn`-Datei aus dem Zusi-Datenverzeichnis.
- **Ortung über die Kilometrierung**: Die aktuelle Position wird als roter Marker angezeigt. Kilometersprünge (Streckenwechsel)
  werden berücksichtigt. Ohne km-Daten wird über die Uhrzeit geortet, ohne beides manuell mit V>0 / V=0.
- **EBuLa-Darstellung**: Spalten Geschwindigkeit, km, Betriebsstellen/Signale, An und Ab. Der Fahrplan läuft
  **von unten nach oben** wie beim Original (umschaltbar). Halte sind fett, Durchfahrten kursiv,
  der nächste Halt ist unterstrichen. Die Geschwindigkeitslinie, Zehntelminuten, Richtungswechsel, Sägelinien
  und Namen rechts werden ebenfalls angezeigt.
- **Verspätung** in Minuten (±), live berechnet aus Ist- und Sollzeiten
- **Meldezeile**: nächster Halt mit Entfernung und Restzeit, Abfahrts-Countdown am Bahnsteig und Verbindungsmeldungen
- **Bedienung wie am EBuLa-Bordgerät** (siehe „Bedienung“): Anmeldung über die Zugnummer, Grundmenü, die drei
  Steuerungsarten Ortung, Zeitsteuerung und Manuell, FSD, Gleiswechsel, Störungsübersicht mit Abhilfetexten und
  Bremshundertstel-Rechner
- **Fahrplanspeicher**: Fahrpläne von Zusi und eingelesene Dateien (`*.timetable.xml`, `*.trn`) werden gespeichert und
  über ihre Zugnummer angemeldet
- **Geschwindigkeitsprofil** (Grundmenü ▸ 4): zulässige und gefahrene Geschwindigkeit über die Strecke, mit Zoom
- **Demo-Fahrt** zum Ausprobieren, mit Zeitraffer bis ×20
- **Tag-/Nachtmodus**, Helligkeit, Bildschirm aus, **Drehen um 90° / 180° / 270°** (UD) für ein hochkant montiertes iPad,
  Zeilenhöhe, Filter „nur Betriebsstellen“ und Vollbild
- Bedienbar per **Touch** (Tasten, Softkeys, Wischen im Fahrplan), **Maus** und **Tastatur**
- **Gerätetöne wie am Bordgerät**, live erzeugt ohne Sounddateien: Klicken der Folientaste mit Piezo-Quittungston,
  Bestätigungston (z. B. Zug angemeldet), Fehlerton (ungültige Eingabe), dreifacher Meldeton bei einer neuen Störung,
  Töne beim Ein- und Ausschalten. Dazu kommt eine kurze **Vibration** bei Tastendruck (Android).
  Tastenton, Lautstärke, Meldetöne und Vibration lassen sich unter Systemdienste einstellen.

## Installation

1. **Node.js** (LTS) auf dem Zusi-PC installieren: <https://nodejs.org>
2. Den Ordner `zusi-ebula` auf den Zusi-PC kopieren.
3. In Zusi 3 sicherstellen, dass der **TCP-Server** aktiv ist (Standard-Port **1436**).
   Für eine flüssige Anzeige das Sendeintervall auf etwa 100 ms stellen.
4. `start.bat` doppelklicken (oder `node bridge.js` in der Eingabeaufforderung ausführen).
   Das Fenster zeigt die Adressen an, zum Beispiel:
   ```
   Auf diesem PC:      http://localhost:8080
   Auf iPad/Tablet:    http://192.168.0.23:8080
   ```
   Fragt die Windows-Firewall nach, den Zugriff im **privaten Netzwerk** erlauben.
5. Auf dem iPad in Safari die angezeigte Adresse öffnen. Für Vollbild: **Teilen ▸ „Zum Home-Bildschirm“**
   und die EBuLa dann vom Home-Bildschirm starten.
6. In Zusi einen Zug starten. Der Buchfahrplan erscheint automatisch.

Die Bridge verbindet sich alle 3 Sekunden neu, Zusi und Bridge lassen sich also in beliebiger Reihenfolge starten.

### Optionen

| Option | Bedeutung |
|---|---|
| `--zusi 192.168.0.10:1436` | Zusi läuft auf einem anderen PC |
| `--port 8081` | anderer HTTP-Port für die Anzeige |

Dieselben Werte lassen sich dauerhaft in `config.json` eintragen (`zusiHost`, `zusiPort`, `httpPort`).
Unter `datenVerzeichnisse` können zusätzliche Zusi-Datenordner für die Suche nach `*.timetable.xml` eingetragen werden.

### Diagnose

`http://localhost:8080/debug` zeigt alle Werte, die Zusi sendet (Führerstandsanzeigen mit ID), und die Programmdaten.
Zusätzliche IDs lassen sich in `config.json` unter `extraFsIds` (dezimal) anfordern.

## Bedienung (wie am Bordgerät)

**Zug anmelden:** Nach dem Einschalten (mit Selbsttest) zeigt das Gerät das Grundbild mit „Zug“ und „G“.
Taste **1 „Zug“** drücken, die Zugnummer mit den Ziffern eingeben und mit **E** bestätigen. Der Fahrplan wird geladen
(blauer Balken). Meldet Zusi einen Zug, ist seine Nummer schon vorgeschlagen, dann reicht 1 und E. Wer das nicht will,
stellt unter Systemdienste „Zug von Zusi automatisch anmelden“ ein.

**Steuerungsarten** (Softkey **7 „Zeit“**):

| Art | Ortsmarker | ▲ ▼ |
|---|---|---|
| 1 Ortung | folgt der Kilometrierung aus Zusi (GPS-Symbol aktiv) | Vorschau blättern |
| 2 Zeitsteuerung | läuft nach Fahrplanzeit. Der Tf startet sie bei der Abfahrt mit **E** (E erneut = anhalten) | Ortsmarker korrigieren, die Verspätung wird neu berechnet |
| 3 Manuell | steht, bis der Tf ihn weiterschaltet | Ortsmarker weiterschalten |

Nach dem Blättern (▲ ▼ ◄ ►) springt die Anzeige nach 10 s von selbst zum Ortsmarker zurück, oder sofort mit C.

| Taste | Funktion |
|---|---|
| 1 Zug | Zug anmelden (Zugnummer) |
| 2 FSD | Fahrplan-Stammdaten: Zugdaten und Halteliste mit Ist-Zeiten (◄ ► umschalten) |
| 6 GW | Gleiswechsel Regelgleis /r ↔ Gegengleis /l |
| 7 Zeit | Steuerungsart wählen |
| 0 G | Grundmenü: 0 Fahrplan · 1 Zug · 2 Systemdienste · 3 Datei einlesen · 4 Geschwindigkeitsprofil · 5 Zug abmelden · 6 Information · 7 Störungen · 9 BRH berechnen |
| St | Störungsübersicht |
| V>0 / V=0 | Abhilfetext zur Störung: kurz während der Fahrt / ausführlich im Stillstand |
| i | Information zur aktuellen Seite |
| S | Systemdienste (Einstellungen) |
| ☀ aus | Bildschirm aus / an |
| ☀ / ◐ | Helligkeit / Kontrast (Tag- und Nachtdarstellung) |
| UD | Display umschalten (um 90° drehen, z. B. für ein hochkant montiertes iPad) |
| ◄ ► | seitenweise blättern / Werte ändern |
| E / C | bestätigen / zurück bzw. Ziffer löschen |

Tastatur: Ziffern, Enter (E), Esc (C), Pfeiltasten, Bild↑/↓ (V>0/V=0), `t` (St), `s` (S), `i`, `n` (Tag/Nacht), `u` (UD), `f` (Vollbild).

LEDs: **KBD** leuchtet bei Tastendruck, **TEMP** leuchtet gelb, solange eine Störung vorliegt (Details mit St).
**GPS** ist durchgestrichen, wenn nicht über die Kilometrierung geortet wird.

Im Handy-Layout liegen Zug, FSD, GW, Zeit, G und St sowie C, Pfeile und E als Touch-Tasten unten. Für die Zugnummer
erscheint ein Ziffernblock. i und S erreichst du über das Grundmenü (G ▸ 6 und G ▸ 2).

## Fahrpult-Anzeige (mittlerer Bildschirm)

`fahrpult.html` ist das mittlere Führerstandsdisplay im Stil moderner E-Loks (TRAXX, Vectron, BR 147). Es läuft über
dieselbe Bridge wie die EBuLa und nutzt dieselben Töne und dieselbe Bridge-Adresse:

- **Tacho** mit Nadel und Digitalwert, AFB-Sollgeschwindigkeit (gelbe Marke), Streckenhöchstgeschwindigkeit (rote Marke
  und roter Bogen). Die Skala wählt sich automatisch (160/200/250/300) oder fest über Softkey 5.
- **Zug-/Bremskraft** als Balken (blau = Zugkraft, gelb = elektrische Bremse) mit Soll-Marke, Skala über Softkey 6
- **Drücke**: Hauptluftleitung, Bremszylinder, Hauptluftbehälter. Außerdem **Oberstrom**, **Fahrdrahtspannung**,
  **Hauptschalter** und **Fahrstufe**
- **Leuchtmelder**: PZB 1000 Hz, 500 Hz, Befehl 40, 85/70/55 (blinkend), Sifa und Zwangsbremsung
- **Diagnose** (Softkey 2): Meldungen, alle Werte von Zusi und die Rohdaten von Sifa und PZB/LZB
- Tag-/Nachtmodus, Helligkeit, Demo-Fahrt ohne Zusi und Wechsel zur EBuLa (Softkey 0)

Öffnen: im Browser `http://<PC-IP>:8080/fahrpult.html` oder in der EBuLa über G ▸ 8. Die Taste **Start ▸** links am
Gerät stellt ein, dass die App künftig gleich mit dem Fahrpult startet.

Die Melder werden aus den verschachtelten Zusi-Daten „Status Sifa“ (0x0064) und „Status Zugbeeinflussung“ (0x0065)
gelesen. Die Zuordnung steht oben in `fahrpult.html` (`SIFA`, `ZB`). Zeigt eine Lok falsche Melder, im Bildschirm
„Diagn.“ oder unter `/debug` die Rohdaten ansehen und die Zuordnung anpassen.

## Handy-App

Auf Handys schaltet die Anzeige automatisch auf ein **Handy-Layout** um: kein Gerätegehäuse, der Fahrplan füllt den
Bildschirm, darunter (im Querformat rechts daneben) liegen große Touch-Tasten. Unter **Menü ▸ Layout** lässt sich das
auch fest einstellen („EBuLa-Gerät“ oder „Handy“).

### Android

1. Die Datei `EBuLa-Zusi3.apk` aufs Handy laden. Sie liegt als Artefakt **EBuLa-Android-APK** bei jedem Lauf der
   GitHub-Action „EBuLa Android-App“ bereit, oder du baust sie selbst (siehe unten).
2. Die APK öffnen. Android fragt, ob Installationen aus dieser Quelle erlaubt sind: einmal zulassen.
3. Die App **EBuLa** starten. Beim ersten Start fragt sie nach der Bridge: die Adresse aus dem `start.bat`-Fenster
   eintragen (z. B. `192.168.0.23:8080`) oder **„Im WLAN suchen“** antippen. Die App sucht die Bridge dann selbst im WLAN.
4. Die Adresse wird gespeichert. Später lässt sie sich unter **Menü ▸ Bridge-Adresse** ändern.

Die App läuft im Vollbild und hält den Bildschirm an. Die Zurück-Taste entspricht der Taste C. Fahrplandateien lassen
sich über „Datei“ auch direkt vom Handy laden. Die Demo funktioniert ohne Netz.

Selbst bauen (Android SDK und JDK 17 nötig):
```
cd zusi-ebula/android
./gradlew assembleRelease      # Ergebnis: app/build/outputs/apk/release/app-release.apk
```
Die APK ist mit einem Debug-Schlüssel signiert. Das reicht zum direkten Installieren, aber nicht für den Play Store.
Wird sie auf einem anderen Rechner gebaut, hat sie eine andere Signatur. Dann die alte App vorher deinstallieren.

### iPhone

Eine App für den App Store braucht einen Mac und ein Apple-Entwicklerkonto. Stattdessen läuft die EBuLa als
**Web-App vom Home-Bildschirm**:

1. Auf dem iPhone in Safari die Adresse der Bridge öffnen (z. B. `http://192.168.0.23:8080`).
2. **Teilen ▸ „Zum Home-Bildschirm“**.
3. Die EBuLa startet dann wie eine App im Vollbild, mit eigenem Icon.

## Ohne Zusi

`public/index.html` lässt sich auch direkt im Browser öffnen. Dann startet die Demo-Fahrt (Zug 4711). Über G ▸ 3 lässt sich jede
`*.timetable.xml` aus dem Zusi-Datenverzeichnis ansehen. Eine Beispieldatei liegt in `beispiele/`.

## Technik

- `bridge.js`: Zusi-3-TCP-Client (Fahrpult-Protokoll: HELLO, NEEDED_DATA, DATA_FTD und DATA_PROG). Er stellt die Daten
  per Server-Sent Events bereit, braucht keine externen Pakete und läuft mit Node.js ab Version 16.
- Angeforderte Führerstandsanzeigen: 0x01 Geschwindigkeit, 0x10–0x12 Uhr, 0x17 AFB-Soll, 0x19 Gesamtweg,
  0x23 Uhrzeit digital, 0x4B Datum, 0x4D Streckenhöchstgeschwindigkeit und 0x61 Kilometrierung Zugspitze.
  Programmdaten: Zugdatei, Zugnummer, Ladepause und Buchfahrplan (XML).
- `public/index.html`: die komplette Anzeige in einer Datei (HTML, CSS und JavaScript), ohne Internetzugang.
- `android/`: Android-App (WebView ohne zusätzliche Bibliotheken). Sie übernimmt `public/` direkt als App-Inhalt.
- `public/manifest.webmanifest` und `sw.js`: Web-App-Manifest, Icons und Offline-Cache für die Home-Bildschirm-Installation.
