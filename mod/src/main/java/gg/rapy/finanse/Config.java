package gg.rapy.finanse;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import net.fabricmc.loader.api.FabricLoader;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Konfiguracja moda. Zapisywana w: .minecraft/config/finanse-tracker.json
 * Wszystkie pola mozna tez zmieniac w GUI moda (klawisz do zbindowania w ustawieniach).
 */
public class Config {
    /** Czy mod ma czytac scoreboard i wysylac dane. */
    public boolean enabled = true;
    /** Adres endpointu serwera (backendu strony). */
    public String endpoint = "http://localhost:3000/api/ingest";
    /** Klucz API - musi byc taki sam jak w konfiguracji serwera. */
    public String apiKey = "zmien-mnie";
    /** Slowo-klucz szukane w liniach scoreboardu (np. FINANSE). */
    public String keyword = "FINANSE";
    /** Co ile sekund wysylac dane na serwer. */
    public int intervalSeconds = 5;

    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

    private static Path path() {
        return FabricLoader.getInstance().getConfigDir().resolve("finanse-tracker.json");
    }

    public static Config load() {
        Path path = path();
        Config cfg;
        try {
            if (Files.exists(path)) {
                cfg = GSON.fromJson(Files.readString(path), Config.class);
                if (cfg == null) cfg = new Config();
            } else {
                cfg = new Config();
                cfg.save();
                FinanseTrackerClient.LOGGER.info("[Finanse] Utworzono domyslny config: {}", path);
            }
        } catch (Exception e) {
            FinanseTrackerClient.LOGGER.error("[Finanse] Blad wczytywania configu, uzywam domyslnego", e);
            cfg = new Config();
        }
        cfg.sanitize();
        return cfg;
    }

    public void sanitize() {
        if (intervalSeconds < 1) intervalSeconds = 1;
        if (intervalSeconds > 600) intervalSeconds = 600;
        if (keyword == null || keyword.isBlank()) keyword = "FINANSE";
        if (endpoint == null) endpoint = "";
        if (apiKey == null) apiKey = "";
    }

    public void save() {
        sanitize();
        Path path = path();
        try {
            Files.createDirectories(path.getParent());
            Files.writeString(path, GSON.toJson(this));
        } catch (IOException e) {
            FinanseTrackerClient.LOGGER.error("[Finanse] Nie moge zapisac configu", e);
        }
    }
}
