package com.conequisa.engraseopenpit;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    // WidgetBridgePlugin es un plugin LOCAL (vive en este mismo módulo
    // android/app, sin paquete npm propio) — se registra a mano ANTES de
    // super.onCreate(), igual que documenta Capacitor para plugins locales.
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WidgetBridgePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
