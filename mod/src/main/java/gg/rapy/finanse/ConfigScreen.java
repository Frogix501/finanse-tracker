package gg.rapy.finanse;

import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.client.gui.widget.TextFieldWidget;
import net.minecraft.text.Text;
import net.minecraft.util.Formatting;

/**
 * GUI moda. Otwierane klawiszem zbindowanym w: Opcje > Sterowanie > Finanse Tracker.
 * Pozwala wlaczyc/wylaczyc czytanie scoreboardu oraz ustawic adres serwera itd.
 */
public class ConfigScreen extends Screen {
    private final Screen parent;

    // robocza kopia ustawien
    private boolean enabled;
    private String endpoint;
    private String apiKey;
    private String keyword;
    private String interval;

    private ButtonWidget toggleButton;
    private TextFieldWidget endpointField;
    private TextFieldWidget apiKeyField;
    private TextFieldWidget keywordField;
    private TextFieldWidget intervalField;

    private String toast = "";
    private long toastUntil = 0;

    public ConfigScreen(Screen parent) {
        super(Text.literal("Finanse Tracker"));
        this.parent = parent;
        Config c = FinanseTrackerClient.CONFIG;
        this.enabled = c.enabled;
        this.endpoint = c.endpoint;
        this.apiKey = c.apiKey;
        this.keyword = c.keyword;
        this.interval = String.valueOf(c.intervalSeconds);
    }

    @Override
    protected void init() {
        int cw = 320;
        int x = (this.width - cw) / 2;
        int y = 50;
        int fh = 20;

        toggleButton = ButtonWidget.builder(toggleText(), b -> {
            enabled = !enabled;
            b.setMessage(toggleText());
        }).dimensions(x, y, cw, fh).build();
        addDrawableChild(toggleButton);
        y += 34;

        endpointField = textField(x, y, cw, endpoint, 256, s -> endpoint = s);
        y += 42;
        keywordField = textField(x, y, cw, keyword, 64, s -> keyword = s);
        y += 42;
        apiKeyField = textField(x, y, cw, apiKey, 128, s -> apiKey = s);
        y += 42;
        intervalField = textField(x, y, cw, interval, 4, s -> interval = s);
        y += 42;

        int bw = (cw - 16) / 3;
        addDrawableChild(ButtonWidget.builder(Text.literal("Testuj"), b -> {
            applyToConfig(true);
            FinanseTrackerClient.sendNow();
            showToast("Wyslano testowo...");
        }).dimensions(x, y, bw, fh).build());

        addDrawableChild(ButtonWidget.builder(Text.literal("Zapisz"), b -> {
            applyToConfig(true);
            showToast("Zapisano!");
        }).dimensions(x + bw + 8, y, bw, fh).build());

        addDrawableChild(ButtonWidget.builder(Text.literal("Zapisz i zamknij"), b -> {
            applyToConfig(true);
            close();
        }).dimensions(x + 2 * (bw + 8), y, bw, fh).build());
    }

    private TextFieldWidget textField(int x, int y, int w, String value, int maxLen,
                                      java.util.function.Consumer<String> onChange) {
        TextFieldWidget f = new TextFieldWidget(this.textRenderer, x, y + 12, w, 20, Text.literal(""));
        f.setMaxLength(maxLen);
        f.setText(value == null ? "" : value);
        f.setChangedListener(onChange);
        addDrawableChild(f);
        return f;
    }

    private Text toggleText() {
        return Text.literal("Czytanie scoreboardu: ")
                .append(enabled
                        ? Text.literal("WLACZONE").formatted(Formatting.GREEN)
                        : Text.literal("WYLACZONE").formatted(Formatting.RED));
    }

    private void applyToConfig(boolean saveFile) {
        Config c = FinanseTrackerClient.CONFIG;
        int oldInterval = c.intervalSeconds;
        c.enabled = enabled;
        c.endpoint = endpoint;
        c.apiKey = apiKey;
        c.keyword = keyword;
        try {
            c.intervalSeconds = Integer.parseInt(interval.trim());
        } catch (NumberFormatException e) {
            c.intervalSeconds = oldInterval;
        }
        c.sanitize();
        interval = String.valueOf(c.intervalSeconds);
        if (saveFile) c.save();
        if (c.intervalSeconds != oldInterval) {
            FinanseTrackerClient.rescheduleSender();
        }
    }

    private void showToast(String msg) {
        toast = msg;
        toastUntil = System.currentTimeMillis() + 2500;
    }

    @Override
    public void render(DrawContext ctx, int mouseX, int mouseY, float delta) {
        super.render(ctx, mouseX, mouseY, delta);

        int cx = this.width / 2;
        ctx.drawCenteredTextWithShadow(this.textRenderer,
                Text.literal("Finanse Tracker").formatted(Formatting.GOLD, Formatting.BOLD),
                cx, 18, 0xFFFFFF);

        // status polaczenia + ostatnia wartosc
        boolean conn = FinanseTrackerClient.isConnected();
        Double val = FinanseTrackerClient.getLatestValue();
        String valStr = val == null ? "brak odczytu" : format(val)
                + (FinanseTrackerClient.getLatestRaw() != null ? "  (" + FinanseTrackerClient.getLatestRaw() + ")" : "");
        Text status = Text.literal("Serwer: ")
                .append(conn ? Text.literal("POLACZONY").formatted(Formatting.GREEN)
                        : Text.literal("BRAK").formatted(Formatting.RED))
                .append(Text.literal("   |   Odczyt: ").formatted(Formatting.GRAY))
                .append(Text.literal(valStr).formatted(Formatting.YELLOW));
        ctx.drawCenteredTextWithShadow(this.textRenderer, status, cx, 32, 0xFFFFFF);

        // etykiety nad polami
        int cw = 320;
        int x = (this.width - cw) / 2;
        int y = 50 + 34;
        label(ctx, x, y, "Adres serwera (endpoint):");
        y += 42;
        label(ctx, x, y, "Slowo-klucz w scoreboardzie:");
        y += 42;
        label(ctx, x, y, "Klucz API (taki sam jak na serwerze):");
        y += 42;
        label(ctx, x, y, "Wysylaj co ile sekund:");

        // dolny status / podpowiedz o klawiszu
        ctx.drawCenteredTextWithShadow(this.textRenderer,
                Text.literal(FinanseTrackerClient.getLastStatus()).formatted(Formatting.DARK_GRAY),
                cx, this.height - 30, 0xAAAAAA);

        if (System.currentTimeMillis() < toastUntil && !toast.isEmpty()) {
            ctx.drawCenteredTextWithShadow(this.textRenderer,
                    Text.literal(toast).formatted(Formatting.AQUA), cx, this.height - 46, 0xFFFFFF);
        }
    }

    private void label(DrawContext ctx, int x, int y, String text) {
        ctx.drawTextWithShadow(this.textRenderer, Text.literal(text).formatted(Formatting.GRAY), x, y, 0xBBBBBB);
    }

    private static String format(double v) {
        double a = Math.abs(v);
        if (a >= 1e12) return round(v / 1e12) + "T";
        if (a >= 1e9) return round(v / 1e9) + "B";
        if (a >= 1e6) return round(v / 1e6) + "M";
        if (a >= 1e3) return round(v / 1e3) + "K";
        return round(v);
    }

    private static String round(double v) {
        if (v == Math.floor(v)) return String.valueOf((long) v);
        return String.format(java.util.Locale.US, "%.2f", v);
    }

    @Override
    public void close() {
        this.client.setScreen(parent);
    }
}
