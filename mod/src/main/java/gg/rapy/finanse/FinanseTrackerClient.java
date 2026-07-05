package gg.rapy.finanse;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.util.InputUtil;
import net.minecraft.scoreboard.Scoreboard;
import net.minecraft.scoreboard.ScoreboardDisplaySlot;
import net.minecraft.scoreboard.ScoreboardEntry;
import net.minecraft.scoreboard.ScoreboardObjective;
import net.minecraft.scoreboard.Team;
import org.lwjgl.glfw.GLFW;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Collection;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class FinanseTrackerClient implements ClientModInitializer {
    public static final String MOD_ID = "finanse_tracker";
    public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    public static Config CONFIG;
    private static Sender SENDER;

    private static KeyBinding openKey;

    // Ostatni odczyt ze scoreboardu (dzielony miedzy watkiem gry a watkiem wysylki)
    private static volatile Double latestValue = null;
    private static volatile String latestRaw = null;
    private static volatile String playerName = "gracz";

    private long lastReadAt = 0;

    private ScheduledExecutorService exec;
    private ScheduledFuture<?> senderTask;

    // Liczba z opcjonalnym separatorem tysiecy i sufiksem K/M/B/T
    private static final Pattern NUMBER =
            Pattern.compile("([0-9][0-9.,\\s\\u00a0\\u202f]*)\\s*([kKmMbBtT])?");

    @Override
    public void onInitializeClient() {
        CONFIG = Config.load();
        SENDER = new Sender(CONFIG);
        LOGGER.info("[Finanse] Zaladowano. enabled={}, endpoint={}, keyword={}",
                CONFIG.enabled, CONFIG.endpoint, CONFIG.keyword);

        openKey = KeyBindingHelper.registerKeyBinding(new KeyBinding(
                "key.finanse_tracker.open",
                InputUtil.Type.KEYSYM,
                GLFW.GLFW_KEY_UNKNOWN, // domyslnie NIEZBINDOWANY - ustaw w Opcje > Sterowanie
                "category.finanse_tracker"));

        exec = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "finanse-sender");
            t.setDaemon(true);
            return t;
        });
        rescheduleSender();

        ClientTickEvents.END_CLIENT_TICK.register(this::onClientTick);
    }

    /** Restartuje cykliczna wysylke wg aktualnego interwalu (wywolywane po zapisie w GUI). */
    public static void rescheduleSender() {
        if (INSTANCE != null) INSTANCE.doReschedule();
    }

    private static FinanseTrackerClient INSTANCE;
    { INSTANCE = this; }

    private void doReschedule() {
        if (exec == null) return;
        if (senderTask != null) senderTask.cancel(false);
        int period = Math.max(1, CONFIG.intervalSeconds);
        senderTask = exec.scheduleAtFixedRate(this::pushIfReady, period, period, TimeUnit.SECONDS);
    }

    private void onClientTick(MinecraftClient client) {
        if (openKey != null) {
            while (openKey.wasPressed()) {
                client.setScreen(new ConfigScreen(client.currentScreen));
            }
        }

        if (client.player != null) {
            playerName = client.player.getGameProfile().getName();
        }

        if (!CONFIG.enabled) return;

        long now = System.currentTimeMillis();
        if (now - lastReadAt < 1000) return; // czytaj max raz na sekunde
        lastReadAt = now;

        readScoreboard(client);
    }

    private void readScoreboard(MinecraftClient client) {
        if (client.world == null) return;
        Scoreboard sb = client.world.getScoreboard();
        ScoreboardObjective obj = sb.getObjectiveForSlot(ScoreboardDisplaySlot.SIDEBAR);
        if (obj == null) return;

        String needle = CONFIG.keyword.toUpperCase();
        Collection<ScoreboardEntry> entries = sb.getScoreboardEntries(obj);
        for (ScoreboardEntry e : entries) {
            Team team = sb.getScoreHolderTeam(e.owner());
            String line = strip(Team.decorateName(team, e.name()).getString());
            if (!line.toUpperCase().contains(needle)) continue;

            Double v = parseAmount(line);
            if (v == null) {
                // awaryjnie: uzyj liczbowej wartosci wyniku (prawa strona scoreboardu)
                v = (double) e.value();
            }
            latestValue = v;
            latestRaw = line.trim();
            return;
        }
    }

    private void pushIfReady() {
        try {
            if (!CONFIG.enabled) return;
            Double v = latestValue;
            if (v == null) return;
            MinecraftClient client = MinecraftClient.getInstance();
            if (client.world == null) return; // wysylaj tylko gdy jestes w grze
            SENDER.send(v, latestRaw, playerName);
        } catch (Exception e) {
            LOGGER.warn("[Finanse] Blad wysylki (push)", e);
        }
    }

    /** Wymusza natychmiastowa wysylke (przycisk "Testuj" w GUI). */
    public static void sendNow() {
        if (INSTANCE != null) INSTANCE.pushImmediate();
    }

    private void pushImmediate() {
        if (exec != null) exec.execute(this::pushIfReady);
    }

    static Double parseAmount(String s) {
        Matcher m = NUMBER.matcher(s);
        while (m.find()) {
            String num = m.group(1);
            String suf = m.group(2);
            String cleaned = num.replaceAll("[\\s\\u00a0\\u202f,]", "").trim();
            // usun ewentalna kropke na koncu (np. "12.")
            if (cleaned.endsWith(".")) cleaned = cleaned.substring(0, cleaned.length() - 1);
            if (cleaned.isEmpty() || cleaned.equals(".")) continue;
            try {
                double base = Double.parseDouble(cleaned);
                double mult = 1;
                if (suf != null && !suf.isEmpty()) {
                    switch (Character.toLowerCase(suf.charAt(0))) {
                        case 'k' -> mult = 1e3;
                        case 'm' -> mult = 1e6;
                        case 'b' -> mult = 1e9;
                        case 't' -> mult = 1e12;
                    }
                }
                return base * mult;
            } catch (NumberFormatException ignored) {
            }
        }
        return null;
    }

    private static String strip(String s) {
        if (s == null) return "";
        // usun kody kolorow (paragraf) na wypadek gdyby gdzies zostaly
        return s.replaceAll("§.", "");
    }

    // --- akcesory dla GUI ---
    public static Double getLatestValue() { return latestValue; }
    public static String getLatestRaw() { return latestRaw; }
    public static boolean isConnected() { return SENDER != null && SENDER.isConnected(); }
    public static String getLastStatus() { return SENDER == null ? "-" : SENDER.getLastStatus(); }
}
