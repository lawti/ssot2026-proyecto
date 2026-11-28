import type {EntityInputColumn, FieldValue} from '../backend/browser-contract.js';
import {element} from './dom.js';
import {editarDisponibilidad, largoDisponibilidad, resumenDisponibilidad} from './disponibilidad.js';

type Column = EntityInputColumn;
type Value = FieldValue;
/* `widget` reemplaza al input en el campo cuando el valor se edita con otro control (el input queda
   oculto adentro, guardando el valor); `refresh` lo vuelve a dibujar cuando cambia su estado. */
type Editor = {input: HTMLInputElement | HTMLSelectElement; read: () => Value; requiredWhenEnabled?: boolean;
    widget?: HTMLElement; refresh?: () => void};

// el resumen de la semana y un botón que abre la grilla
function disponibilidadEditor(label: string): Editor {
    const input = element('input');
    input.type = 'hidden';
    const resumen = element('span');
    resumen.className = 'disponibilidad-resumen';
    const editar = element('button', 'Editar');
    editar.type = 'button';
    editar.setAttribute('aria-label', `Editar ${label.toLowerCase()}`);
    const widget = element('div');
    widget.className = 'disponibilidad-campo';
    widget.append(resumen, editar, input);
    const refresh = () => {
        resumen.textContent = input.disabled ? 'Ninguna' : resumenDisponibilidad(input.value);
        resumen.title = resumen.textContent;
        editar.disabled = input.disabled;
    };
    editar.onclick = async () => {
        const nuevo = await editarDisponibilidad(input.value, label);
        if (nuevo === undefined || nuevo === input.value) return;
        input.value = nuevo;
        refresh();
        input.dispatchEvent(new Event('change', {bubbles: true}));
    };
    // un horario sin tocar es una semana vacía, que también es un valor válido
    return {input, widget, refresh, read: () => input.value || '0'.repeat(largoDisponibilidad)};
}

function integerEditor(constraints: Column['constraints']): Editor {
    const input = element('input');
    input.type = 'number';
    input.step = '1';
    if (constraints.minimum !== undefined) input.min = String(constraints.minimum);
    return {input, read: () => input.valueAsNumber, requiredWhenEnabled: true};
}

function enumEditor(constraints: Column['constraints']): Editor {
    const input = element('select');
    input.add(new Option('Ninguna', ''));
    for (const value of constraints.options ?? []) input.add(new Option(value, value));
    return {input, read: () => input.value, requiredWhenEnabled: true};
}

// Each supported display type has one editor. Adding a backend type requires a renderer.
const editors = {
    text: (_constraints) => {
        const input = element('input');
        return {input, read: () => input.value};
    },
    password: constraints => {
        const input = element('input');
        input.type = 'password';
        input.autocomplete = 'new-password';
        input.minLength = constraints.minLength ?? 0;
        input.maxLength = constraints.maxLength ?? 524288;
        return {input, read: () => input.value};
    },
    integer: integerEditor,
    posInteger: integerEditor,
    rol: enumEditor,
    nivelAcademico: enumEditor,
    estadoClase: enumEditor,
    estadoSolicitud: enumEditor,
    estadoAmistad: enumEditor,
    estadoSolicitante: enumEditor,
    estadoParticipante: enumEditor,
    // input date ya trabaja en YYYY-MM-DD, la misma forma serializada del tipo fecha
    fecha: (_constraints) => {
        const input = element('input');
        input.type = 'date';
        return {input, read: () => input.value, requiredWhenEnabled: true};
    },
    // step de media hora, alineado con la disponibilidad
    hora: (_constraints) => {
        const input = element('input');
        input.type = 'time';
        input.step = '1800';
        return {input, read: () => input.value, requiredWhenEnabled: true};
    },
    instante: constraints => {
        const input = element('input');
        input.placeholder = 'AAAA-MM-DDTHH:MM:SS.sssZ';
        input.maxLength = constraints.maxLength ?? 524288;
        return {input, read: () => input.value, requiredWhenEnabled: true};
    },
    disponibilidad: (_constraints, label) => disponibilidadEditor(label),
    boolean: (_constraints) => {
        const input = element('select');
        input.add(new Option('No', 'false'));
        input.add(new Option('Sí', 'true'));
        return {input, read: () => input.value === 'true'};
    },
} satisfies Record<Column['type'], (constraints: Column['constraints'], label: string) => Editor>;

// Shared by row editing and equality filters; null remains distinct from empty text.
export function createValueField(column: Column, value?: Value, optional = false) {
    const editor: Editor = editors[column.type](column.constraints, column.label);
    const input = editor.input;
    const select = input instanceof HTMLSelectElement;
    input.id = `field-${crypto.randomUUID()}`;
    input.name = column.name;
    if (select && column.nullable && ![...input.options].some(option => option.value === '')) {
        input.add(new Option('Ninguna', ''), 0);
    }
    input.value = String(value ?? (column.type === 'boolean' && !column.nullable ? false : ''));
    input.required = (!column.nullable || (!select && !!editor.requiredWhenEnabled)) && !optional;
    if (optional && input instanceof HTMLInputElement) input.placeholder = 'Sin cambios';
    const label = element('label', column.label + (optional ? ' (opcional)' : ''));
    label.htmlFor = input.id;
    const field = element('div');
    field.className = 'field';
    field.append(label, editor.widget ?? input);
    const empty = element('input');
    empty.type = 'checkbox';
    empty.checked = column.nullable && !select && value == null;
    if (column.nullable && !select) {
        const nullLabel = element('label');
        nullLabel.className = 'null-option';
        nullLabel.append(empty, document.createTextNode(' Ninguna'));
        field.append(nullLabel);
        empty.onchange = () => { input.disabled = empty.checked; editor.refresh?.(); };
    }
    input.disabled = empty.checked;
    editor.refresh?.();
    return {field, label: label.textContent!, input, read: (): Value | undefined => {
        if (optional && input.value === '') return undefined;
        return empty.checked || (select && column.nullable && input.value === '') ? null : editor.read();
    }};
}
