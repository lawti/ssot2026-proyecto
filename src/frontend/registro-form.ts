/* El formulario de alta: los campos los manda el SSOT (GET /api/registro) y se dibujan con el
   mismo editor de valores que usa la planilla. Los datos del usuario son comunes; los del perfil
   dependen del rol elegido, y los del rol no elegido quedan deshabilitados (no se validan ni envían).
   Los campos de tipo disponibilidad no van en los datos: tienen su propio paso optativo, con la
   grilla en la página. Los roles que eligen materias (eligenMaterias) tienen otro paso optativo.
   Un rol sin pasos optativos (el alumno) ve uno solo, sin pestañas. */

import type {EntityInputColumn, EntityRow, RegistroCampos, RegistroRequest, RolRegistrable} from '../backend/browser-contract.js';
import type {Problem} from 'system-definition';
import {crearGrilla, type Grilla} from './disponibilidad.js';
import {element} from './dom.js';
import {messageOf} from './messages.js';
import {createValueField} from './value-field.js';
import {crearSelectorMaterias} from './selector-materias.js';
import {registroMaterias} from './api.js';

type Campo = {column: EntityInputColumn; field: HTMLElement; error: HTMLElement; read: () => EntityRow[string] | undefined};
const pasos = ['datos', 'horarios', 'materias'] as const;
type Paso = typeof pasos[number];
const titulos: Record<Paso, string> = {datos: 'Datos', horarios: 'Horarios (opcional)', materias: 'Materias (opcional)'};

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
    const paneles = Object.fromEntries(pasos.map(paso => [paso, form.querySelector<HTMLElement>(`#registro-${paso}`)!])) as Record<Paso, HTMLElement>;
    const roles = form.querySelector<HTMLElement>('#registro-roles')!;
    const datos = form.querySelector<HTMLElement>('#registro-usuario')!;
    const perfiles = form.querySelector<HTMLElement>('#registro-perfil')!;
    const siguiente = form.querySelector<HTMLButtonElement>('#registro-siguiente')!;
    const crear = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
    for (const container of [pestanas, roles, datos, perfiles, paneles.horarios, paneles.materias]) container.replaceChildren();

    const usuario = crearCampos(campos.usuario, datos);
    const materias = crearSelectorMaterias(registroMaterias);
    paneles.materias.append(materias.elemento);
    // cada rol registrable trae los campos de su subtipo; no se listan acá
    const porRol = (Object.keys(campos.perfiles) as RolRegistrable[]).map(rol => {
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
        const horarios = campos.perfiles[rol].filter(esHorario).map(column => crearHorario(column, grupoHorarios));
        const eligeMaterias = campos.eligenMaterias.includes(rol);
        return {rol, radio, grupo, grupoHorarios, horarios, eligeMaterias,
            campos: crearCampos(campos.perfiles[rol].filter(column => !esHorario(column)), grupo),
            // los pasos de este rol, en orden: los optativos solo si tiene algo que cargar en ellos
            pasos: pasos.filter(paso => paso === 'datos' || (paso === 'horarios' ? horarios.length > 0 : eligeMaterias))};
    });
    const elegido = () => porRol.find(({radio}) => radio.checked);
    const pasosActuales = (): readonly Paso[] => elegido()?.pasos ?? ['datos'];
    const todos = () => [...usuario, ...porRol.flatMap(({campos, horarios}) => [...campos, ...horarios])];

    const tabs = Object.fromEntries(pasos.map(paso => {
        const tab = element('button');
        tab.type = 'button';
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-controls', paneles[paso].id);
        tab.onclick = () => mostrar(paso);
        pestanas.append(tab);
        return [paso, tab];
    })) as Record<Paso, HTMLButtonElement>;
    let actual: Paso = 'datos';
    function mostrar(paso: Paso): void {
        actual = paso;
        const visibles = pasosActuales();
        for (const nombre of pasos) {
            const tab = tabs[nombre];
            tab.hidden = !visibles.includes(nombre);
            tab.textContent = `${visibles.indexOf(nombre) + 1}. ${titulos[nombre]}`;
            tab.setAttribute('aria-selected', String(nombre === paso));
            paneles[nombre].hidden = nombre !== paso;
        }
        pestanas.hidden = visibles.length < 2;
        siguiente.hidden = paso === visibles.at(-1);
        crear.classList.toggle('primary', siguiente.hidden); // un solo botón principal por paso
        form.classList.toggle('registro-ancho', paso !== 'datos');
        if (paso === 'horarios') elegido()!.horarios.forEach(({grilla}) => grilla.mostrar());
        if (paso === 'materias') materias.mostrar();
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
    siguiente.onclick = () => {
        const visibles = pasosActuales();
        if (datosValidos()) mostrar(visibles[visibles.indexOf(actual) + 1]!);
    };

    return {
        valid: datosValidos,
        read: (): RegistroRequest => {
            const {rol, campos, horarios, eligeMaterias} = elegido()!;
            const elegidas = eligeMaterias ? materias.elegidas() : [];
            return {rol, usuario: leer(usuario), perfil: {...leer(campos), ...leer(horarios)}, ...(elegidas.length ? {materias: elegidas} : {})};
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
