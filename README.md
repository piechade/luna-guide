# Luna Guide

Ein unabhängiges, interaktives 3D-Lernmodell für die Bedienung einer Mondphasenuhr am Beispiel der Tudor 1926 Luna. Version 2 überarbeitet Gehäuse, Krone, Zifferblatt, Zeiger, Mondanzeige, Armband und die Oberfläche.

Die Anwendung füllt das Browserfenster. Auf dem Desktop steht das Modell links; nur der Inhalt rechts scrollt. Auf dem Handy teilen sich Modell und Anleitung einen Bildschirm. Die Schrittsteuerung bleibt erreichbar. Bei fehlendem WebGL erscheint die vollständige Textanleitung.

## Bedienung

- **Entdecken:** Modell drehen und zoomen, Ansichten wechseln, Kronenpositionen und Drehrichtungen ausprobieren. Das Modell zeigt zunächst die Gerätezeit, das heutige Datum und die genäherte Mondphase. In Position 3 bewegen die Zeiger das Werk; laufen sie vorwärts über Mitternacht, schalten Datum und Mondscheibe. Im Schaltfenster des Kalenders (ca. 20 bis 4 Uhr Werkzeit) verweigert das Modell die Schnellkorrektur.
- **Einstellen:** Sieben einzeln wählbare Schritte mit Pause und Wiederholung. Die Animationen laufen verkürzt; beim Zeitabgleich wartet das Modell auf eine tatsächliche volle Minute der Gerätezeit.
- **Werk · 24 h:** Die Anzeige am Modell zeigt, was das Zifferblatt verbirgt: die Zeit des Werks auf einer 24-Stunden-Skala, das Datum und ob die Kalenderschaltung gerade eingreift.
- **Werk von vorn:** Glas, Zeiger und Zifferblatt heben ab. Darunter liegt das Werk, nach veröffentlichten Unterlagen des Kalibers modelliert: Datumsring mit 31 Innenzähnen und Doppelraste, 24-Stunden-Kalenderrad mit gefedertem Doppelfinger, den ab etwa 21:30 Uhr die Auslösewippe kurz vor dem Datumszahn hält, bis ein Stift des Rades sie um Mitternacht anhebt und der Finger Datum und Mond schaltet, 14-zackiges Sternrad, dessen 28er-Trieb die 118 Zähne der Mondscheibe um zwei Zähne pro Tag weiterdreht, Zeigerwerk unter der Wechselradbrücke, Schnellkorrektur in Position 2: das Zeigerstellrad treibt den schwenkenden Doppelkorrektor, der Richtung 12 Uhr mit seinem Finger den Datumsring und Richtung 6 Uhr über den Tageskorrektor das Sternrad um einen Schritt je Kronenumdrehung weiterschaltet; Aufzugwelle, Kupplungs- und Aufzugtrieb, Winkelhebel mit Raste, Kupplungshebel, Schalthebel und Stopphebel. Ist die Krone gezogen, gibt ein Ausschnitt im Datumsring den Blick auf das Aufzug- und Stellwerk frei. Krone, Zeiger und Kalender bewegen das Werk mit.
- **Werk von hinten:** Der Gehäuseboden fällt nach unten weg; die Kamera blickt von unten auf Werkplatte mit Perlage, Brücken mit Genfer Streifen, Unruh mit Spirale und Rücker, Anker und Hemmungsrad, Räderwerk, Kronrad, Sperrrad mit Klinke, Automatikgestell und Rotor. Die Unruh schwingt mit 4 Hz, solange das Werk läuft, und steht in Position 3 still; der Rotor pendelt, wenn das Modell gedreht wird, und zieht das Sperrrad auf.
- **Tastatur:** 1 Gesamtansicht, 2 Zifferblatt, 3 Krone, 4 Werk von vorn, 5 Werk von hinten (jeweils noch einmal zum Schließen); Pfeiltasten drehen das Modell, Plus und Minus zoomen (mit Umschalt in feinen Schritten). Die Schaltflächen sind per Tab erreichbar.

Die Moduswahl folgt dem [WAI-ARIA-Muster für Tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/): Tab erreicht den aktiven Reiter, Links/Rechts und Pos1/Ende wechseln den Fokus, Enter oder Leertaste aktiviert den Reiter. Danach führt Tab in seinen Inhalt. Eine Sprungmarke überspringt das Modell. Bei einem Schrittwechsel erhält die neue Überschrift den Fokus; der Lesebereich ist mit der Tastatur scrollbar. Animationszähler werden nicht als laufende Screenreader-Meldungen ausgegeben.

## Einstellfolge

Die Uhr kann zu jeder Tageszeit stehen geblieben sein, und ein Zwölf-Stunden-Zifferblatt zeigt nicht, in welcher Tageshälfte das Werk steht. Datum und Mondscheibe schalten aber nur um Mitternacht des Werks. Die Anleitung setzt die Tageshälfte deshalb nie voraus, sondern lässt sie die Uhr selbst beweisen. Das Verfahren entspricht der Anleitung von POINTtec für die Sellita-Kaliber SW200, SW280 und SW290.

1. Krone aufschrauben.
2. Von Hand aufziehen; der Zähler zeigt einen beispielhaften Aufzug.
3. Zeiger vorwärts auf 5 Uhr stellen. 5 Uhr morgens und 5 Uhr nachmittags liegen beide außerhalb des Schaltfensters des Kalenders (ca. 20 bis 4 Uhr Werkzeit); die Schnellkorrektur ist dort in jeder Tageshälfte gefahrlos. POINTtec nennt 6 Uhr; auf der 5 verdeckt der Stundenzeiger das Mondfenster nicht, und einer nachmittags geparkten, weiterlaufenden Uhr bleiben drei statt zwei Stunden bis zum Fenster.
4. Datum per Schnellkorrektur auf die Zahl vor dem heutigen Datum stellen. Auf der Datumsscheibe mit 31 Positionen ist das vor dem Monatsersten die 31, auch nach einem kürzeren Monat.
5. Mondphase einstellen: einen Mond mittig stellen, dann einen Klick für jeden Kalendertag vom letzten Vollmond bis gestern.
6. Zeiger vorwärts drehen, bis das Datum auf heute springt. Das ist die Mitternacht des Werks; ein Durchgang durch die Zwölf ohne Sprung war der Mittag. Von dort weiter zur Uhrzeit der Referenz (vor 12 Uhr ohne weiteren Durchgang durch die Zwölf, sonst genau einen) und zur vollen Minute starten.
7. Krone verschrauben, Endkontrolle.

Der Datumssprung in Schritt 6 ist zugleich die Kontrolle: Springt das Datum auf heute und danach nicht noch einmal, stimmen Tageshälfte, Datum und Mondphase. Eine Sonderregel für bestimmte Uhrzeiten gibt es nicht, und der Text von Schritt 6 hängt nicht von der Uhrzeit ab, zu der er geöffnet wurde: Mittag oder Mitternacht dürfen während des Zeigerstellens vergehen. Was „die Zahl vor heute“ ist, legt die Anleitung einmal fest, wenn der Kalenderschritt geöffnet wird. Diese Zahlen bleiben 90 Minuten stehen, auch beim Zurückblättern und nach einem Neuladen der Seite; vergeht in dieser Zeit eine echte Mitternacht, nennt Schritt 6 den zweiten Datumssprung. Danach schickt die Anleitung zurück zu Schritt 3, weil die geparkte Uhr weiterläuft und sich dem Schaltfenster nähert.

Im Modell entsteht jeder Datumswechsel aus der Zeigerbewegung: `src/watch/mechanism.ts` bildet die Zeit des Werks über 24 Stunden ab und schaltet Datum und Mondscheibe genau dann, wenn die Zeiger vorwärts Mitternacht erreichen. Kein Schritt setzt ein Datum direkt. Der Stillstand des Modells wird bei jedem Besuch neu gewählt (Uhrzeit und Tageshälfte); `?stop=HH:MM` legt ihn für Vorführungen fest.

Die Mondklicks zählen ganze Kalendertage seit dem Datum des letzten Vollmonds, wie es die Hersteller beschreiben. `src/moon.ts` berechnet die Vollmondzeitpunkte nach Meeus (Astronomical Algorithms, Kapitel 49) auf wenige Minuten genau; das Datum richtet sich nach der Zeitzone des Geräts. Die Gerätezeit ist keine extern geprüfte Zeitquelle. Für diese Uhr nennt der Hersteller kein Schaltfenster; die Anleitung meidet das größte, das für die Kaliberfamilie veröffentlicht ist.

## Entwicklung

TypeScript, Three.js und Vite; kein Backend und keine extern geladenen Grafik- oder Schriftdateien.

```bash
npm install
npm run dev
npm test
npm run build
```

`npm test` prüft ohne Browser: das Werkmodell (`tests/mechanism.test.mjs`), die Einstellprozedur für jede Stillstandszeit und jede Uhrzeit einschließlich Monatswechseln, Schalttag, Zeitumstellung und Vollmondtag (`tests/plan.test.mjs`), die Vollmondzeitpunkte und die Tageszählung für die Mondscheibe (`tests/moon.test.mjs`) sowie die Anleitungstexte in allen Varianten (`tests/steps.test.mjs`), die Kameraposen samt der Ansichten der geöffneten Uhr (`tests/views.test.mjs`) und die Zeitleiste der Animationen.

`node tests/guide.browser.mjs` fährt die animierte Anleitung im Browser durch: acht Uhrzeiten mal vier Stillstandszeiten, dazu das Kronenlabor im Entdecken-Modus und in jedem Schritt die von vorn und von hinten geöffnete Uhr. `node tests/accessibility.browser.mjs` prüft Tastaturbedienung, zugängliche Rollen und Namen, Statusmeldungen und den Textfallback. `node tests/smoke.browser.mjs` prüft den fertigen Build (`npm run build && npm run preview`, `LUNA_URL=http://127.0.0.1:4173`, oder den Container): Start ohne Konsolenfehler und ohne Verstöße gegen die Content-Security-Policy, sieben Schritte, heutiges Datum nach Schritt 6 und beide Textfallbacks. Die ersten beiden laufen gegen einen laufenden Dev-Server; alle benötigen eine vorhandene Playwright-Installation; alternativ deren Modulpfad über `PLAYWRIGHT_MODULE` angeben. `CHROMIUM_EXECUTABLE` wählt bei Bedarf einen vorhandenen Chromium-Browser, `LUNA_URL` eine andere lokale URL. Diese Browserprüfungen ersetzen keinen Hörtest mit NVDA oder VoiceOver.

`src/watch/` enthält das Werkmodell (`mechanism.ts`), die gemeinsamen Maße (`dimensions.ts`) und je ein Modul für Gehäuse, Armband, Zifferblatt, Zeiger und Krone; `model.ts` setzt sie zusammen und zeichnet den Zustand des Werks. Das 3D-Werk liegt in `src/watch/movement/`: `data.ts` hält Lage, Höhen, Zahnzahlen und Phasen aller Teile und die Funktionen, die aus dem Zustand der Uhr ihre Winkel machen; `dial-side.ts` (Kalender- und Zeigerwerk, Schnellkorrektur), `keyless.ts` (Aufzug- und Stellwerk auf beiden Seiten der Platine, Kronrad, Sperrrad, Klinke) und `back-side.ts` (Platine, Brücken, Räderwerk, Hemmung, Unruh, Automatik, Rotor) bauen daraus die Teile. Es wird erst beim ersten Öffnen der Uhr geladen (eigener Chunk `movement-*.js`, nicht vorgeladen) und in Abschnitten gebaut; geschlossen ist es nicht im Szenengraphen und kostet pro Bild nichts. `src/plan.ts` leitet aus der Uhrzeit ab, was zu stellen ist. `src/steps.ts` definiert die Anleitungstexte und Animationen; `src/animator.ts` verarbeitet Ereignisse und Wartepunkte. `src/boot.ts` ist der kleine Einstieg: Er zeigt Seite und Ladezustand sofort und lädt die 3D-Anwendung (`src/main.ts`) nach; schlägt das fehl, erscheint die Textanleitung. Der Diagnosezugriff `window.__luna` existiert nur im Entwicklungsmodus. `deploy.sh` enthält die bestehende Veröffentlichung per rsync und Docker; der Build allein veröffentlicht nichts.

## Referenz und Grenzen

Die [offizielle Referenzuhr](https://www.tudorwatch.com/de/watches/1926/m91560-0002) wird als Modell mit Kaliber T607-9 beschrieben. Das Projekt nutzt ergänzend die SW280-1-Familie als technische Vergleichsbasis, ohne eine vollständige Identität aller Bauteile zu behaupten. Das 3D-Modell ist eine Visualisierung, kein vermessenes CAD-Modell oder fertigungstauglicher Entwurf. Das Werk der geöffneten Uhr ist nach veröffentlichten Unterlagen modelliert: Achslagen von Kalenderrad, Sternrad, Mondscheibe, Unruh und Anker, Durchmesser und Bauhöhe, die Zahnzahlen 14, 28, 118 und 31, die Lage von Datums- und Mondfenster. Was die Unterlagen nicht zeigen, ist eigene Auslegung und insoweit Prinzipdarstellung: die übrigen Zahnzahlen und Verzahnungsmodule, Umrisse von Brücken und Hebeln, der Antrieb der Schnellkorrektur in Position 2, das Getriebe unter dem Automatikgestell und ein Räderwerk mit Großbodenrad in der Mitte. Die Aufzugwelle liegt auf der Höhe der Modellkrone, 0,25 mm tiefer als im Kaliber. Firmen- und Kalibernamen stehen auf keinem Teil; graviert sind nur neutrale Angaben.

Für die echte Uhr gilt die [Herstelleranleitung](https://media.tudorwatch.com/image/upload/v1/tudorwatch/modelpage/userguides/tudor-userguides-en.pdf). Keine Verbindung zu oder Freigabe durch TUDOR oder Sellita.

[Design- und Technikprüfung](docs/review-2026-09-09.md) · [Rechtliche Vorprüfung und offene Fragen](docs/legal-review-2026-09-09.md) · [Drittanbieter-Lizenzen](public/THIRD_PARTY_NOTICES.txt)
