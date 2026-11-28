import assert from 'node:assert/strict';
import test from 'node:test';
import {largoDisponibilidad, resumenDisponibilidad} from '../dist/frontend/disponibilidad.js';

// marca [dia, desde, hasta) en medias horas, con lunes = 0, como en value-types.ts
function semana(...franjas) {
    const bits = Array(largoDisponibilidad).fill('0');
    for (const [dia, desde, hasta] of franjas) for (let slot = desde; slot < hasta; slot++) bits[dia * 48 + slot] = '1';
    return bits.join('');
}

test('the availability summary groups days with the same hours', () => {
    assert.equal(largoDisponibilidad, 336);
    assert.equal(resumenDisponibilidad(semana()), 'Sin horarios');
    assert.equal(resumenDisponibilidad(semana(...[0, 1, 2, 3, 4].map(dia => [dia, 32, 42]))), 'Lun–Vie 16:00–21:00');
    assert.equal(resumenDisponibilidad(semana([1, 28, 40], [3, 28, 40], [5, 18, 26])), 'Mar, Jue 14:00–20:00 · Sáb 09:00–13:00');
    assert.equal(resumenDisponibilidad(semana([0, 18, 26], [0, 33, 34])), 'Lun 09:00–13:00, 16:30–17:00');
    assert.equal(resumenDisponibilidad(semana([0, 0, 48], [1, 0, 48], [6, 47, 48])), 'Lun, Mar 00:00–24:00 · Dom 23:30–24:00');
});
