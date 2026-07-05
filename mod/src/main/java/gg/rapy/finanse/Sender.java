package gg.rapy.finanse;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Locale;

/**
 * Wysyla stan konta na serwer strony (HTTP POST JSON).
 * Czyta pola z zywego obiektu Config, wiec zmiany endpointu / api key dzialaja od razu.
 */
public class Sender {
    private final Config config;
    private final HttpClient http;

    private volatile boolean everOk = false;
    private volatile long lastOkAt = 0;
    private volatile String lastStatus = "brak polaczenia";
    private long lastErrorLog = 0;

    public Sender(Config config) {
        this.config = config;
        this.http = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .build();
    }

    public boolean isConnected() {
        return everOk && (System.currentTimeMillis() - lastOkAt) < 30_000;
    }

    public String getLastStatus() {
        return lastStatus;
    }

    public void send(double value, String raw, String player) {
        String endpoint = config.endpoint;
        if (endpoint == null || endpoint.isBlank()) {
            lastStatus = "brak adresu serwera";
            return;
        }
        String json = String.format(Locale.US,
                "{\"value\":%.4f,\"raw\":%s,\"player\":%s,\"ts\":%d}",
                value, jsonStr(raw), jsonStr(player), System.currentTimeMillis());

        HttpRequest req;
        try {
            req = HttpRequest.newBuilder()
                    .uri(URI.create(endpoint))
                    .timeout(Duration.ofSeconds(8))
                    .header("Content-Type", "application/json")
                    .header("X-Api-Key", config.apiKey == null ? "" : config.apiKey)
                    .POST(HttpRequest.BodyPublishers.ofString(json))
                    .build();
        } catch (Exception e) {
            lastStatus = "zly adres: " + e.getMessage();
            logErr(lastStatus);
            return;
        }

        try {
            HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
            int code = resp.statusCode();
            if (code >= 200 && code < 300) {
                lastOkAt = System.currentTimeMillis();
                lastStatus = "polaczono (HTTP " + code + ")";
                if (!everOk) {
                    everOk = true;
                    FinanseTrackerClient.LOGGER.info("[Finanse] Polaczono z serwerem OK: {}", endpoint);
                }
            } else {
                lastStatus = "HTTP " + code + ": " + trim(resp.body());
                logErr(lastStatus);
            }
        } catch (Exception e) {
            lastStatus = "blad: " + e.getMessage();
            logErr(lastStatus);
        }
    }

    private void logErr(String msg) {
        long now = System.currentTimeMillis();
        if (now - lastErrorLog > 30_000) {
            lastErrorLog = now;
            FinanseTrackerClient.LOGGER.warn("[Finanse] {}", msg);
        }
    }

    private static String trim(String s) {
        if (s == null) return "";
        s = s.strip();
        return s.length() > 120 ? s.substring(0, 120) + "..." : s;
    }

    private static String jsonStr(String s) {
        if (s == null) return "null";
        StringBuilder b = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"' -> b.append("\\\"");
                case '\\' -> b.append("\\\\");
                case '\n' -> b.append("\\n");
                case '\r' -> b.append("\\r");
                case '\t' -> b.append("\\t");
                default -> {
                    if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
                    else b.append(c);
                }
            }
        }
        return b.append('"').toString();
    }
}
