# 💰 Finanse Tracker — mod Minecraft + strona WWW

Zestaw dwóch części, które współpracują:

1. **Mod Fabric (Minecraft 1.21.4)** — czyta scoreboard na serwerze (linię z `FINANSE`),
   wyłuskuje stan konta (np. `14.93K`) i wysyła go na Twój serwer WWW.
   Ma **GUI** otwierane klawiszem (do zbindowania w ustawieniach), gdzie
   włączasz/wyłączasz czytanie scoreboardu i ustawiasz adres serwera + klucz API.
2. **Serwer + dashboard (Node.js)** — odbiera dane z moda i pokazuje ładną stronę
   z aktualnym stanem konta, tempem zarobku (`$/min`, `$/h`), wykresami
   (stan konta w czasie, zarobek wg godziny, zarobek dzienny), celem i prognozą.

```
finanse-tracker/
├─ mod/        ← mod Fabric (Java, budowany Gradle)
└─ server/     ← backend + dashboard (Node.js, bez zależności)
```

---

## 1. Serwer + dashboard

### Uruchomienie lokalne (na Twoim PC)

Wymaga **Node.js 18+** (masz 22 — OK).

```bash
cd finanse-tracker/server
node server.js
```

W konsoli pojawi się coś takiego:

```
==================================================
  FINANSE TRACKER - serwer wystartowal
  Dashboard:  http://localhost:3000
  Endpoint dla moda:  http://localhost:3000/api/ingest
  API KEY:  a1b2c3d4e5f6...        <-- SKOPIUJ TEN KLUCZ
==================================================
```

- **Dashboard** otwórz w przeglądarce: <http://localhost:3000>
- **API KEY** skopiuj — wpiszesz go w GUI moda (musi się zgadzać).

Klucz zapisuje się w `server/config.json`, a historia w `server/data/history.json`.

### Hosting online (żeby strona miała stały adres URL)

Najprościej — darmowy **Render.com**:

1. Wrzuć folder `server/` na GitHub (albo cały projekt).
2. Render → **New → Web Service** → podłącz repo.
3. Ustaw:
   - **Root Directory:** `finanse-tracker/server` (jeśli wrzuciłeś cały projekt)
   - **Build Command:** *(puste — brak zależności)*
   - **Start Command:** `node server.js`
   - **Environment variable:** `FINANSE_API_KEY` = *(wpisz własny długi losowy klucz)*
4. Deploy. Dostaniesz adres typu `https://finanse-tracker.onrender.com`.
   - Dashboard: `https://finanse-tracker.onrender.com`
   - Endpoint dla moda: `https://finanse-tracker.onrender.com/api/ingest`

> Uwaga: darmowy Render „usypia" po ~15 min bezczynności — pierwszy request budzi go
> po kilku sekundach. Do prywatnego użytku w zupełności wystarcza.

Zadziała też każdy inny hosting Node (Railway, Fly.io, VPS itp.).

---

## 2. Mod Minecraft (Fabric 1.21.4)

### Budowanie (tworzy plik `.jar`)

Wymaga **JDK 21** (masz Temurin 21 — OK). Gradle nie trzeba instalować, jest wrapper.

```bash
cd finanse-tracker/mod
./gradlew build            # Linux / macOS / Git Bash
gradlew.bat build          # Windows CMD / PowerShell
```

Gotowy mod: **`mod/build/libs/finanse-tracker-1.0.0.jar`**
(plik `*-sources.jar` pomiń — to tylko źródła.)

### Instalacja

1. Zainstaluj **Fabric Loader** na Minecraft **1.21.4**
   (instalator: <https://fabricmc.net/use/installer/>).
2. Wrzuć do folderu `.minecraft/mods`:
   - `finanse-tracker-1.0.0.jar` (ten mod),
   - **Fabric API** na 1.21.4 (<https://modrinth.com/mod/fabric-api>).
3. Odpal Minecraft z profilem Fabric.

### Konfiguracja w grze

1. **Zbinduj klawisz:** *Opcje → Sterowanie → kategoria „Finanse Tracker" →
   „Otwórz panel Finanse Tracker"*. Ustaw np. `P`. (Domyślnie klawisz jest pusty.)
2. Wejdź na serwer, naciśnij zbindowany klawisz — otworzy się **panel moda**:
   - **Czytanie scoreboardu: WŁĄCZONE / WYŁĄCZONE** — przełącznik (klik żeby zmienić),
   - **Adres serwera (endpoint)** — np. `http://localhost:3000/api/ingest`
     albo `https://twoj-serwer.onrender.com/api/ingest`,
   - **Słowo-klucz w scoreboardzie** — domyślnie `FINANSE` (linia którą ma czytać),
   - **Klucz API** — ten sam, co wypisał serwer / ustawiłeś w `FINANSE_API_KEY`,
   - **Wysyłaj co ile sekund** — domyślnie `5`.
3. Kliknij **Testuj** (wyśle od razu) albo **Zapisz i zamknij**.
   Na dole panelu widać status połączenia z serwerem i ostatnio odczytaną wartość.

Ustawienia zapisują się też w `.minecraft/config/finanse-tracker.json` — można je
edytować ręcznie.

---

## Jak to działa (skrót)

```
[Minecraft + mod]  --(HTTP POST co N sek.)-->  [serwer /api/ingest]  -->  history.json
                                                       |
[przeglądarka] <--(GET /api/data co 3 sek.)-- [dashboard]
```

- Mod co sekundę czyta sidebar scoreboardu, znajduje linię z `FINANSE`
  i parsuje liczbę (obsługuje `K`/`M`/`B`/`T` oraz separatory tysięcy).
- Serwer trzyma historię punktów (stan konta w czasie) i podaje ją stronie.
- Strona liczy tempo zarobku, sumy dzienne/godzinowe, sesję, cel i prognozy.

## Funkcje dashboardu

- **Stan konta** na żywo (animowana liczba, format `K/M/B/T`) + nick + surowy tekst ze scoreboardu.
- **Tempo:** `$/min` i `$/h` (z ostatnich ~5 min).
- **Dzisiaj:** zarobek od północy.
- **Sesja:** zysk, czas trwania, tempo startowe, rekord `$/min`, szczyt konta.
- **Wykres stanu konta** w czasie (zakresy: 1h / 6h / 24h / 7d / całość).
- **Zarobek wg godziny** (dziś) — widać, o której godzinie zarabiasz najwięcej.
- **Zarobek dzienny** (14 dni).
- **🎯 Cel** — wpisujesz np. `1M`, pasek postępu + **ETA** przy obecnym tempie.
- **🔮 Prognoza** — ile będziesz miał za 1h / 8h / do końca dnia / za 24h.
- **⚙ Ustawienia** — adres API (gdy strona hostowana osobno), częstotliwość odświeżania,
  dźwięk przy zarobku.

## Wielu graczy (jedna strona, osobne konta)

Serwer obsługuje wielu graczy naraz — dane są rozdzielane po **nicku** (mod wysyła nick
automatycznie z gry). Kolega nie musi nic stawiać: instaluje tego samego moda, wpisuje
**TEN SAM adres** endpointu i klucz API, wchodzi do gry — i pojawia się na liście.

Na dashboardzie w prawym górnym rogu jest **przełącznik gracza** — wybierasz nick i widzisz
jego stan konta, wykresy oraz osobne (per gracz) cele i resety boxów.

## Rozwiązywanie problemów

- **Panel pokazuje „Serwer: BRAK"** — zły adres/endpoint lub serwer nie działa. Sprawdź
  `endpoint` (musi kończyć się na `/api/ingest`) i czy serwer jest uruchomiony.
- **„zły api key" (HTTP 401)** — klucz w modzie ≠ klucz serwera. Skopiuj dokładnie.
- **Odczyt: „brak odczytu"** — mod nie znalazł linii z `FINANSE`. Upewnij się, że jesteś
  na serwerze gdzie scoreboard pokazuje finanse, i że słowo-klucz się zgadza
  (np. zmień na inne słowo z Twojego scoreboardu).
- **Strona online, serwer lokalny** — mod z gry musi mieć dostęp do adresu; przy hostingu
  online użyj publicznego URL, nie `localhost`.
