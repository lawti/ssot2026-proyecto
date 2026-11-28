import assert from 'node:assert/strict';
import test from 'node:test';
import {conAcento, sinAcento, textoBuscable as enSql} from '../dist/backend/entity-query.js';
import {textoBuscable} from '../dist/frontend/texto.js';

test('searches ignore case and accents the same way in the browser and in SQL', () => {
    assert.equal(conAcento.length, sinAcento.length);
    // cada letra que translate cambia en SQL, el navegador la lleva a la misma, también en mayúscula
    [...conAcento].forEach((letra, i) => {
        assert.equal(textoBuscable(letra), sinAcento[i], letra);
        assert.equal(textoBuscable(letra.toUpperCase()), sinAcento[i], letra.toUpperCase());
    });
    assert.equal(textoBuscable('Álgebra'), 'algebra');
    assert.equal(textoBuscable('Educación Física — AÑO'), 'educacion fisica — ano');
    assert.equal(enSql('"materia"'), `translate(lower("materia"), '${conAcento}', '${sinAcento}')`);
});
