/* El formulario de alta: los campos los manda el SSOT (GET /api/registro) y se dibujan con el
   mismo editor de valores que usa la planilla. Los datos del usuario son comunes; los del perfil
   dependen del rol elegido, y los del rol no elegido quedan deshabilitados (no se validan ni envían).
   Los campos de tipo disponibilidad no van en los datos: tienen su propio paso optativo, con la
   grilla en la página. El rol que no tiene esos campos (el alumno) ve un solo paso, sin pestañas. */

import type {EntityInputColumn, EntityRow, RegistroCampos, RegistroRequest, RolRegistrable} from '../backend/browser-contract.js';
import type {Problem} from 'system-definition';
import {crearGrilla, type Grilla} from './disponibilidad.js';
import {element} from './dom.js';
import {messageOf} from './messages.js';
import {createValueField} from './value-field.js';

type Campo = {column: EntityInputColumn; field: HTMLElement; error: HTMLElement; read: () => EntityRow[string] | undefined};
type Paso = 'datos' | 'horarios';

function crearError(field: HTMLElement): HTMLElement {
    const error = element('span');
    error.className = 'field-error';
    field.append(error);
    return error;
}

function crearCampos(columns: readonly EntityInputColumn[], container: HTMLElement): Campo[] {
    return columns.map(column => {
        const editor = createValueField(column);
        container.append(editor.field);
        return {column, field: editor.field, error: crearError(editor.field), read: editor.read};
    });
}

// un horario: la grilla en la página; sin nada marcado se registra sin horarios
function crearHorario(column: EntityInputColumn, container: HTMLElement): Campo & {grilla: Grilla} {
    const grilla = crearGrilla();
    const field = element('div');
    field.className = 'field';
    field.append(grilla.elemento);
    const acciones = element('div');
    acciones.className = 'actions';
    acciones.append(grilla.limpiar);
    field.append(acciones);
    container.append(field);
    return {column, field, grilla, error: crearError(field), read: () => grilla.vacia() ? null : grilla.valor()};
}

const leer = (campos: readonly Campo[]): EntityRow =>
    Object.fromEntries(campos.flatMap(campo => {
        const value = campo.read();
        return value === undefined ? [] : [[campo.column.name, value]];
    }));

export function createRegistroForm(campos: RegistroCampos, form: HTMLFormElement) {
    const pestanas = form.querySelector<HTMLElement>('#registro-pasos')!;
    const paneles = {datos: form.querySelector<HTMLElement>('#registro-datos')!, horarios: form.querySelector<HTMLElement>('#registro-horarios')!};
    const roles = form.querySelector<HTMLElement>('#registro-roles')!;
    const datos = form.querySelector<HTMLElement>('#registro-usuario')!;
    const perfiles = form.querySelector<HTMLElement>('#registro-perfil')!;
    const siguiente = form.querySelector<HTMLButtonElement>('#registro-siguiente')!;
    const crear = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
    for (const container of [pestanas, roles, datos, perfiles, paneles.horarios]) container.replaceChildren();

    const usuario = crearCampos(campos.usuario, datos);
    // cada rol registrable trae los campos de su subtipo; no se listan acá
    const porRol = (Object.keys(campos) as (keyof RegistroCampos)[]).filter((rol): rol is RolRegistrable => rol !== 'usuario')
        .map(rol => {
            const radio = element('input');
            radio.type = 'radio';
            radio.name = 'rol';
            radio.value = rol;
            radio.required = true;
            const label = element('label');
            label.append(radio, document.createTextNode(` ${rol[0]!.toUpperCase()}${rol.slice(1)}`));
            roles.append(label);
            const grupo = element('fieldset');
            const grupoHorarios = element('fieldset');
            perfiles.append(grupo);
            paneles.horarios.append(grupoHorarios);
            const esHorario = (column: EntityInputColumn) => column.type === 'disponibilidad';
            return {rol, radio, grupo, grupoHorarios,
                campos: crearCampos(campos[rol].filter(column => !esHorario(column)), grupo),
                horarios: campos[rol].filter(esHorario).map(column => crearHorario(column, grupoHorarios))};
        });
    const elegido = () => porRol.find(({radio}) => radio.checked);
    const todos = () => [...usuario, ...porRol.flatMap(({campos, horarios}) => [...campos, ...horarios])];

    const tabs = {datos: element('button', '1. Datos'), horarios: element('button', '2. Horarios (opcional)')};
    for (const [paso, tab] of Object.entries(tabs) as [Paso, HTMLButtonElement][]) {
        tab.type = 'button';
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-controls', paneles[paso].id);
        tab.onclick = () => mostrar(paso);
        pestanas.append(tab);
    }
    function mostrar(paso: Paso): void {
        for (const [nombre, tab] of Object.entries(tabs) as [Paso, HTMLButtonElement][]) {
            tab.setAttribute('aria-selected', String(nombre === paso));
            paneles[nombre].hidden = nombre !== paso;
        }
        const conHorarios = !!elegido()?.horarios.length;
        pestanas.hidden = !conHorarios;
        siguiente.hidden = !conHorarios || paso !== 'datos';
        crear.classList.toggle('primary', siguiente.hidden); // un solo botón principal por paso
        form.classList.toggle('registro-ancho', paso === 'horarios');
        if (paso === 'horarios') elegido()!.horarios.forEach(({grilla}) => grilla.mostrar());
    }
    roles.onchange = () => {
        for (const {radio, grupo, grupoHorarios} of porRol) grupo.hidden = grupo.disabled = grupoHorarios.hidden = grupoHorarios.disabled = !radio.checked;
        mostrar('datos');
    };
    roles.onchange(new Event('change'));
    // los datos se validan antes de pasar de paso y antes de enviar, mostrando dónde falta algo
    const datosValidos = () => {
        if ([...paneles.datos.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')].every(input => input.checkValidity())) return true;
        mostrar('datos');
        form.reportValidity();
        return false;
    };
    siguiente.onclick = () => { if (datosValidos()) mostrar('horarios'); };

    return {
        valid: datosValidos,
        read: (): RegistroRequest => {
            const {rol, campos, horarios} = elegido()!;
            return {rol, usuario: leer(usuario), perfil: {...leer(campos), ...leer(horarios)}};
        },
        // los nombres de usuario y de perfil no se repiten, así que cada problema tiene un solo lugar
        problems: (problems: readonly Problem[]): boolean => {
            let ubicados = false;
            for (const campo of todos()) {
                campo.error.textContent = problems.filter(problem => problem.field === campo.column.name)
                    .map(problem => messageOf(problem, campo.column.constraints)).join('; ');
                campo.field.classList.toggle('has-error', !!campo.error.textContent);
                ubicados ||= !!campo.error.textContent;
            }
            // se muestra el paso con el primer error
            const primero = todos().find(campo => campo.error.textContent && !campo.field.closest('fieldset:disabled'));
            if (primero) mostrar(paneles.horarios.contains(primero.field) ? 'horarios' : 'datos');
            return ubicados;
        },
    };
}
export type RegistroForm = ReturnType<typeof createRegistroForm>;
