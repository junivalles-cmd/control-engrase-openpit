// Synthetic inline fixtures only: no Vite server, Supabase or production network.
import {defineConfig} from '@playwright/test';
import path from 'node:path';
export default defineConfig({
 testDir:path.resolve('tests/ui'),testMatch:['support-grants-indexeddb.spec.js','lubricador-mi-turno-real-execution.spec.js'],
 outputDir:path.resolve('node_modules/.cache/playwright-support'),workers:2,timeout:20000,
 reporter:'list',use:{baseURL:'http://fixture.invalid',trace:'off',screenshot:'off'},
 projects:[{name:'phone-390',use:{viewport:{width:390,height:844},hasTouch:true}},{name:'phone-412',use:{viewport:{width:412,height:915},hasTouch:true}}]
});
