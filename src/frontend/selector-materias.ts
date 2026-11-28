/* Elegir materias del catálogo: las elegidas arriba (se quitan con ×) y abajo la lista con buscador.
   Sigue la regla de la planilla: si el catálogo vino completo se filtra acá; si no, cada búsqueda
   se pide al servidor. Las elegidas se conservan aunque no estén en la búsqueda actual. */

import type {RegistroMaterias} from '../backend/browser-contract.js';
import {element} from './dom.js';
import {textoBuscable} from './texto.js';

export const maximoMaterias = 30; // el mismo tope que valida el servidor

export function crearSelectorMaterias(buscar: (q?: string) => Promise<RegistroMaterias>) {
    const elegidas = new Set<string>();
    const elemento = element('div');
    elemento.className = 'selector-materias';
    const ayuda = element('p', 'Elegí las materias que enseñás. Es opcional.');
    ayuda.className = 'muted';
    const chips = element('div');
    chips.className = 'materias-elegidas';
    chips.setAttribute('aria-label', 'Materias elegidas');
    const busqueda = element('input');
    busqueda.type = 'search';
    busqueda.placeholder = 'Buscar materia…';
    busqueda.setAttribute('aria-label', 'Buscar materia');
    const lista = element('div');
    lista.className = 'materias-lista';
    lista.setAttribute('role', 'group');
    lista.setAttribute('aria-label', 'Materias');
    const estado = element('p');
    estado.className = 'muted';
    estado.setAttribute('role', 'status');
    elemento.append(ayuda, chips, busqueda, lista, estado);

    let catalogo: RegistroMaterias | undefined;
    let resultados: string[] = [];
    let pedido = 0; // descarta respuestas de búsquedas que ya cambiaron

    function dibujar(): void {
        chips.replaceChildren(...[...elegidas].map(materia => {
            const chip = element('span', materia);
            chip.className = 'materia-chip';
            const quitar = element('button', '×');
            quitar.type = 'button';
            quitar.setAttribute('aria-label', `Quitar ${materia}`);
            quitar.onclick = () => { elegidas.delete(materia); dibujar(); };
            chip.append(quitar);
            return chip;
        }));
        chips.hidden = !elegidas.size;
        const lleno = elegidas.size >= maximoMaterias;
        lista.replaceChildren(...resultados.map(materia => {
            const casilla = element('input');
            casilla.type = 'checkbox';
            casilla.checked = elegidas.has(materia);
            casilla.disabled = lleno && !casilla.checked;
            casilla.onchange = () => { if (casilla.checked) elegidas.add(materia); else elegidas.delete(materia); dibujar(); };
            const label = element('label');
            label.append(casilla, document.createTextNode(` ${materia}`));
            return label;
        }));
        lista.hidden = !resultados.length;
        estado.textContent = lleno ? `Llegaste al máximo de ${maximoMaterias} materias.`
            : !catalogo ? 'Cargando materias…'
            : catalogo.completo && !catalogo.materias.length ? 'Todavía no hay materias cargadas.'
            : !resultados.length ? 'No hay materias que coincidan con la búsqueda.'
            // sin búsqueda, un catálogo grande muestra solo el comienzo
            : catalogo.completo || busqueda.value.trim() ? '' : 'Hay muchas materias: escribí para buscar entre todas.';
    }

    async function actualizar(): Promise<void> {
        const q = busqueda.value.trim();
        if (catalogo?.completo) {
            resultados = catalogo.materias.filter(materia => textoBuscable(materia).includes(textoBuscable(q)));
            return dibujar();
        }
        const actual = ++pedido;
        try {
            const respuesta = await buscar(q || undefined);
            if (actual !== pedido) return;
            catalogo = respuesta;
            resultados = respuesta.materias;
            dibujar();
        } catch (error) {
            if (actual === pedido) estado.textContent = error instanceof Error ? error.message : 'No se pudieron cargar las materias.';
        }
    }
    // Enter en el buscador no envía el formulario de registro
    busqueda.onkeydown = event => { if (event.key === 'Enter') event.preventDefault(); };
    let espera: ReturnType<typeof setTimeout> | undefined;
    busqueda.oninput = () => {
        clearTimeout(espera);
        // filtrar en el navegador es inmediato; pedirle al servidor espera a que se deje de escribir
        espera = setTimeout(() => void actualizar(), catalogo?.completo ? 0 : 250);
    };
    dibujar();

    return {
        elemento,
        elegidas: () => [...elegidas],
        // el catálogo se pide la primera vez que se muestra el paso
        mostrar: () => { if (!catalogo) void actualizar(); },
    };
}
export type SelectorMaterias = ReturnType<typeof crearSelectorMaterias>;
