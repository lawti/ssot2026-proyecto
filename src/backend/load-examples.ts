import {Pool} from 'pg';
import {databaseConfig} from './database.js';
import {loadTabData} from './tab-data.js';
import {loadExamples} from './examples.js';

// Sin argumento carga los ejemplos incluidos; con un directorio, sus archivos .tab.
const pool = new Pool(databaseConfig);
try {
    const directory = process.argv[2];
    console.log(`Se cargaron ${directory ? await loadTabData(pool, directory) : await loadExamples(pool)} filas.`);
} catch (error) {
    console.error('No se cargaron los datos:', error instanceof Error ? error.message : 'Error desconocido.');
    process.exitCode = 1;
} finally { await pool.end(); }
