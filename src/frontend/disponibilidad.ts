/* El editor del tipo disponibilidad (ver value-types.ts): un '0'/'1' por media hora de la semana,
   de lunes 00:00 a domingo 23:30. Se muestra como un resumen legible y se edita en un diálogo
   con la grilla semanal, pintando con el mouse, el dedo o el teclado. */

import {element} from './dom.js';

const dias = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const;
const diasLargos = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'] as const;
const porDia = 48;
export const largoDisponibilidad = dias.length * porDia;
const primeraVisible = 16; // la grilla abre mostrando las 08:00

const hora = (slot: number): string => `${String(Math.floor(slot / 2)).padStart(2, '0')}:${slot % 2 ? '30' : '00'}`;

// las franjas de un día, como "09:00–13:00, 16:00–21:00"
function franjas(value: string, dia: number): string {
    const tramos: string[] = [];
    for (let slot = 0; slot < porDia; slot++) {
        if (value[dia * porDia + slot] !== '1') continue;
        const desde = slot;
        while (slot < porDia && value[dia * porDia + slot] === '1') slot++;
        tramos.push(`${hora(desde)}–${slot === porDia ? '24:00' : hora(slot)}`);
    }
    return tramos.join(', ');
}

// días consecutivos se abrevian como rango: "Lun–Vie", "Lun, Mié"
function listaDeDias(indices: readonly number[]): string {
    const partes: string[] = [];
    for (let i = 0; i < indices.length; i++) {
        let fin = i;
        while (fin + 1 < indices.length && indices[fin + 1] === indices[fin]! + 1) fin++;
        partes.push(fin - i >= 2 ? `${dias[indices[i]!]}–${dias[indices[fin]!]}` : indices.slice(i, fin + 1).map(d => dias[d]).join(', '));
        i = fin;
    }
    return partes.join(', ');
}

/** "Lun–Vie 16:00–21:00 · Sáb 09:00–13:00"; los días con las mismas franjas se agrupan. */
export function resumenDisponibilidad(value: string): string {
    const grupos = new Map<string, number[]>();
    dias.forEach((_, dia) => {
        const texto = franjas(value, dia);
        if (texto) grupos.set(texto, [...grupos.get(texto) ?? [], dia]);
    });
    return grupos.size ? [...grupos].map(([texto, indices]) => `${listaDeDias(indices)} ${texto}`).join(' · ') : 'Sin horarios';
}

/** La grilla semanal, para dibujar en la página o en el diálogo. `mostrar` la lleva a las 08:00
    y se llama cuando ya está visible (antes no tiene tamaño). Sin valor, arranca sin horarios. */
export function crearGrilla(value?: string | null) {
    const marcados = [...(value?.length === largoDisponibilidad ? value : '0'.repeat(largoDisponibilidad))].map(bit => bit === '1');
    const ayuda = element('p', 'Arrastrá de una esquina a la otra para marcar un bloque de días y horarios; si empezás sobre una celda marcada, el bloque se desmarca. Con el teclado: flechas y espacio.');
    ayuda.className = 'muted';

    const tabla = element('table');
    tabla.className = 'disponibilidad-grilla';
    tabla.setAttribute('role', 'grid');
    tabla.tabIndex = 0;
    const filaDias = tabla.createTHead().insertRow();
    filaDias.append(element('th'));
    for (const dia of dias) filaDias.append(element('th', dia));
    const cuerpo = tabla.createTBody();
    const celdas: HTMLTableCellElement[] = new Array(largoDisponibilidad);
    for (let slot = 0; slot < porDia; slot++) {
        const fila = cuerpo.insertRow();
        const etiqueta = element('th', slot % 2 ? '' : hora(slot));
        etiqueta.scope = 'row';
        fila.append(etiqueta);
        dias.forEach((_, dia) => {
            const celda = fila.insertCell();
            const indice = dia * porDia + slot;
            celda.dataset['slot'] = String(indice);
            celda.setAttribute('role', 'gridcell');
            celda.setAttribute('aria-label', `${diasLargos[dia]} ${hora(slot)}`);
            celdas[indice] = celda;
        });
    }
    const pintar = (indice: number, valor: boolean) => {
        marcados[indice] = valor;
        celdas[indice]!.classList.toggle('marcada', valor);
        celdas[indice]!.setAttribute('aria-selected', String(valor));
    };
    marcados.forEach((valor, indice) => pintar(indice, valor));

    /* Arrastrar selecciona el rectángulo entre la celda donde empezó y la actual (días × horarios),
       y le aplica el valor opuesto al de esa primera celda. Mientras se arrastra, lo que queda fuera
       del rectángulo vuelve a como estaba al empezar. */
    let arrastre: {ancla: number; valor: boolean; antes: boolean[]} | undefined;
    const celdaEn = (event: PointerEvent) =>
        (document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null)?.closest<HTMLElement>('td[data-slot]');
    const seleccionar = (hasta: number) => {
        const {ancla, valor, antes} = arrastre!;
        const [d0, d1] = [Math.floor(ancla / porDia), Math.floor(hasta / porDia)].sort((a, b) => a - b) as [number, number];
        const [s0, s1] = [ancla % porDia, hasta % porDia].sort((a, b) => a - b) as [number, number];
        antes.forEach((previo, indice) => {
            const dia = Math.floor(indice / porDia), slot = indice % porDia;
            const nuevo = dia >= d0 && dia <= d1 && slot >= s0 && slot <= s1 ? valor : previo;
            if (marcados[indice] !== nuevo) pintar(indice, nuevo);
        });
    };
    tabla.onpointerdown = event => {
        const celda = celdaEn(event);
        if (!celda) return;
        event.preventDefault();
        enFoco = Number(celda.dataset['slot']);
        arrastre = {ancla: enFoco, valor: !marcados[enFoco], antes: [...marcados]};
        tabla.setPointerCapture(event.pointerId); // soltar fuera de la grilla también cierra el arrastre
        seleccionar(enFoco);
        tabla.focus({preventScroll: true});
    };
    tabla.onpointermove = event => {
        const celda = arrastre && celdaEn(event);
        if (celda) seleccionar(Number(celda.dataset['slot']));
    };
    const soltar = () => { arrastre = undefined; };
    tabla.onpointerup = soltar;
    tabla.onpointercancel = soltar;

    let enFoco = primeraVisible;
    const mostrarFoco = () => {
        celdas.forEach(celda => celda.classList.remove('foco'));
        celdas[enFoco]!.classList.add('foco');
        celdas[enFoco]!.scrollIntoView({block: 'nearest'});
        tabla.setAttribute('aria-activedescendant', celdas[enFoco]!.id ||= `slot-${crypto.randomUUID()}`);
    };
    tabla.onfocus = mostrarFoco;
    tabla.onblur = () => celdas[enFoco]!.classList.remove('foco');
    tabla.onkeydown = event => {
        const dia = Math.floor(enFoco / porDia), slot = enFoco % porDia;
        const destino = {ArrowUp: [dia, slot - 1], ArrowDown: [dia, slot + 1], ArrowLeft: [dia - 1, slot], ArrowRight: [dia + 1, slot]}[event.key];
        if (destino) {
            const [d, s] = destino as [number, number];
            if (d >= 0 && d < dias.length && s >= 0 && s < porDia) enFoco = d * porDia + s;
            mostrarFoco();
        } else if (event.key === ' ' || event.key === 'Enter') {
            pintar(enFoco, !marcados[enFoco]);
        } else return;
        event.preventDefault();
    };

    const contenedor = element('div');
    contenedor.className = 'disponibilidad-scroll';
    contenedor.append(tabla);

    const limpiar = element('button', 'Borrar todo');
    limpiar.type = 'button';
    limpiar.onclick = () => marcados.forEach((_, indice) => pintar(indice, false));

    const elemento = element('div');
    elemento.className = 'disponibilidad-editor';
    elemento.append(ayuda, contenedor);
    return {
        elemento, limpiar,
        valor: () => marcados.map(valor => valor ? '1' : '0').join(''),
        vacia: () => !marcados.includes(true),
        mostrar: () => { contenedor.scrollTop = celdas[primeraVisible]!.offsetTop - tabla.tHead!.offsetHeight; },
    };
}
export type Grilla = ReturnType<typeof crearGrilla>;

/** Abre la grilla en un diálogo; devuelve el valor nuevo, o undefined si se cancela. */
export function editarDisponibilidad(value: string, titulo: string): Promise<string | undefined> {
    const grilla = crearGrilla(value);
    const dialog = element('dialog');
    dialog.className = 'disponibilidad-dialog';
    dialog.setAttribute('aria-label', titulo);
    const encabezado = element('div');
    encabezado.className = 'dialog-header';
    encabezado.append(element('h2', titulo));
    const cancelar = element('button', 'Cancelar');
    cancelar.type = 'button';
    const aceptar = element('button', 'Aceptar');
    aceptar.type = 'button';
    aceptar.className = 'primary';
    const acciones = element('div');
    acciones.className = 'actions';
    acciones.append(grilla.limpiar, cancelar, aceptar);

    dialog.append(encabezado, grilla.elemento, acciones);
    document.body.append(dialog);
    dialog.showModal();
    grilla.mostrar();

    return new Promise(resolve => {
        const cerrar = (resultado: string | undefined) => { dialog.close(); dialog.remove(); resolve(resultado); };
        cancelar.onclick = () => cerrar(undefined);
        dialog.oncancel = event => { event.preventDefault(); cerrar(undefined); };
        aceptar.onclick = () => cerrar(grilla.valor());
    });
}
