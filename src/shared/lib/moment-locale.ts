/**
 * Idioma de moment para toda la app: español (TSK-795).
 *
 * moment arranca en inglés y los datos del español solo existen si alguien importa
 * `moment/locale/es`, que además cambia el idioma global como efecto secundario. Antes
 * lo hacían algunos archivos sueltos, así que el idioma de una pantalla dependía de qué
 * módulos se hubieran cargado ("October" en el balance del mes). Se carga una sola vez:
 * en el layout raíz (componentes de servidor y server actions) y en `Providers` (SSR y
 * navegador).
 *
 * Las semanas se calculan con `isoWeek`, que no depende del idioma.
 */
import moment from 'moment';
import 'moment/locale/es';

moment.locale('es');
