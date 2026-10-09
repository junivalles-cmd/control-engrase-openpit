package com.conequisa.engraseopenpit;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Widget real de pantalla de inicio para "Mi Turno" (Control de Engrase) —
 * SOLO LECTURA del snapshot minimo que escribe WidgetBridgePlugin (nunca
 * recalcula nada por su cuenta, nunca conoce planes/assignments/COMPLETE/
 * PARTIAL/scope — esa logica es exclusiva de la app web, ver §4 del
 * pedido "NO duplicar logica en Android").
 *
 * Tamano adaptativo simple (§2 del pedido): si el ancho disponible alcanza
 * para 4x2, se usa el layout ancho (con hasta 3 equipos); si no, el
 * compacto 2x2 (solo contexto + 3 contadores). Un solo tap en cualquier
 * parte del widget abre la app (MainActivity) — primera version, sin
 * acciones por equipo (§3 del pedido).
 */
public class LubricantShiftWidgetProvider extends AppWidgetProvider {

    private static final int WIDE_MIN_WIDTH_DP = 250;

    public static void requestUpdate(Context context) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(context);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(context, LubricantShiftWidgetProvider.class));
        if (ids.length == 0) return;
        Intent intent = new Intent(context, LubricantShiftWidgetProvider.class);
        intent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
        context.sendBroadcast(intent);
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int id : appWidgetIds) {
            updateOne(context, appWidgetManager, id);
        }
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager appWidgetManager, int appWidgetId, Bundle newOptions) {
        updateOne(context, appWidgetManager, appWidgetId);
    }

    private void updateOne(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        SharedPreferences prefs = context.getSharedPreferences(WidgetBridgePlugin.PREFS_NAME, Context.MODE_PRIVATE);
        boolean hasSnapshot = prefs.getBoolean("hasSnapshot", false);

        Bundle options = appWidgetManager.getAppWidgetOptions(appWidgetId);
        int minWidth = options != null ? options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0) : 0;
        boolean wide = minWidth >= WIDE_MIN_WIDTH_DP;

        RemoteViews views;
        PendingIntent openApp = PendingIntent.getActivity(
                context, 0, new Intent(context, MainActivity.class),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        if (!hasSnapshot) {
            views = new RemoteViews(context.getPackageName(), R.layout.widget_lubricant_shift_empty);
            views.setOnClickPendingIntent(R.id.widget_empty_root, openApp);
            views.setOnClickPendingIntent(R.id.widget_empty_open_btn, openApp);
        } else {
            views = new RemoteViews(context.getPackageName(),
                    wide ? R.layout.widget_lubricant_shift_wide : R.layout.widget_lubricant_shift_small);

            String location = prefs.getString("location", "");
            String shift = prefs.getString("shift", "");
            int overdue = prefs.getInt("overdue", 0);
            int pending = prefs.getInt("pending", 0);
            int completed = prefs.getInt("completed", 0);

            String contextLine = (location == null || location.isEmpty()) ? shift : (location + " · " + shift);
            views.setTextViewText(R.id.widget_context, contextLine);
            views.setTextViewText(R.id.widget_overdue_value, String.valueOf(overdue));
            views.setTextViewText(R.id.widget_pending_value, String.valueOf(pending));
            views.setTextViewText(R.id.widget_completed_value, String.valueOf(completed));
            views.setTextViewText(R.id.widget_updated, formatUpdatedAt(prefs.getString("updatedAt", "")));

            if (wide) {
                int count = prefs.getInt("equipmentCount", 0);
                int[] rowIds = {R.id.widget_eq_row_0, R.id.widget_eq_row_1, R.id.widget_eq_row_2};
                int[] textIds = {R.id.widget_eq_0, R.id.widget_eq_1, R.id.widget_eq_2};
                for (int i = 0; i < 3; i++) {
                    if (i < count) {
                        views.setViewVisibility(rowIds[i], View.VISIBLE);
                        views.setTextViewText(textIds[i], prefs.getString("equipment" + i, ""));
                    } else {
                        views.setViewVisibility(rowIds[i], View.GONE);
                    }
                }
            }

            views.setOnClickPendingIntent(R.id.widget_root, openApp);
        }

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }

    // updatedAt llega en ISO-8601 UTC (new Date().toISOString() de JS, ver
    // widget-snapshot.js) — se muestra en HH:mm de la zona del dispositivo,
    // nunca se asume UTC en pantalla (mismo criterio que fmtDate() en el
    // resto de la app).
    private String formatUpdatedAt(String iso) {
        if (iso == null || iso.length() < 19) return "";
        try {
            SimpleDateFormat parser = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US);
            parser.setTimeZone(TimeZone.getTimeZone("UTC"));
            Date date = parser.parse(iso.substring(0, 19));
            SimpleDateFormat out = new SimpleDateFormat("HH:mm", Locale.getDefault());
            return "Actualizado " + out.format(date);
        } catch (Exception e) {
            return "";
        }
    }
}
