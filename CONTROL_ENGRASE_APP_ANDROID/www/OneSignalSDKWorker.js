// OneSignalSDKWorker.js
//
// Este archivo lo necesita OneSignal para poder mostrar notificaciones en el NAVEGADOR
// aunque la pestaña esté cerrada. Debe estar en la RAÍZ del sitio (junto a index.html),
// con este nombre exacto — si se mueve o se renombra, el push web deja de funcionar.
//
// No hay que editarlo nunca: solo carga el código de OneSignal.
// (El Service Worker propio de la app, sw.js, sigue funcionando aparte para el modo
// sin conexión — son dos cosas distintas y no se estorban entre sí.)

importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');
