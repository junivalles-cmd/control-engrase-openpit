package com.conequisa.engraseopenpit;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Puente minimo Web -> Android para el widget de pantalla de inicio "Mi
 * Turno" (Control de Engrase). Plugin LOCAL de Capacitor (sin dependencia
 * npm nueva, registrado a mano en MainActivity) que solo guarda el
 * snapshot YA calculado por la app web (ver src/core/widget-snapshot.js)
 * en SharedPreferences PRIVADAS de esta app (MODE_PRIVATE, nunca
 * exportadas/compartidas).
 *
 * NUNCA recibe ni guarda JWT, contraseña, PIN, refresh token, apikey ni el
 * payload completo de equipos — solo los 6 campos minimos del snapshot
 * (ubicacion, turno, 3 contadores, hasta 3 codigos de equipo, hora de
 * actualizacion).
 */
@CapacitorPlugin(name = "WidgetBridge")
public class WidgetBridgePlugin extends Plugin {
    public static final String PREFS_NAME = "engrase_widget_prefs";

    @PluginMethod
    public void updateSnapshot(PluginCall call) {
        Context ctx = getContext();
        SharedPreferences.Editor editor = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit();
        editor.putBoolean("hasSnapshot", true);
        editor.putString("location", call.getString("location", ""));
        editor.putString("shift", call.getString("shift", ""));
        editor.putInt("overdue", call.getInt("overdue", 0));
        editor.putInt("pending", call.getInt("pending", 0));
        editor.putInt("completed", call.getInt("completed", 0));
        editor.putString("updatedAt", call.getString("updatedAt", ""));

        JSArray equipment = call.getArray("equipment");
        int count = 0;
        try {
            count = equipment != null ? Math.min(equipment.length(), 3) : 0;
        } catch (Exception e) {
            count = 0;
        }
        editor.putInt("equipmentCount", count);
        for (int i = 0; i < 3; i++) {
            String value = "";
            if (i < count) {
                try {
                    value = equipment.getString(i);
                } catch (Exception e) {
                    value = "";
                }
            }
            editor.putString("equipment" + i, value);
        }
        editor.apply();

        LubricantShiftWidgetProvider.requestUpdate(ctx);
        call.resolve();
    }

    // Cambio de usuario / sin sesion (§7 del pedido): nunca deja a la
    // vista datos del usuario anterior — borra TODO el snapshot (nunca
    // IndexedDB, que esta funcion ni siquiera puede alcanzar) y el widget
    // vuelve al estado "Abre la aplicacion para ver tu turno".
    @PluginMethod
    public void clearSnapshot(PluginCall call) {
        Context ctx = getContext();
        ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().clear().apply();
        LubricantShiftWidgetProvider.requestUpdate(ctx);
        call.resolve();
    }
}
