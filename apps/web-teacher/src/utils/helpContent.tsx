// Contenido en espanol SIN tildes para evitar problemas de encoding en Windows/cp1252.
import type { ReactNode } from "react"

type HelpContentMap = Record<string, ReactNode>

export const helpContent: HelpContentMap = {
  export: (
    <div className="space-y-4 text-zinc-300">
      <p className="text-lg font-medium text-[var(--text-inverse)]">Exportar Dataset Academico</p>
      <p>
        Genera un dataset anonimizado con los episodios, eventos y clasificaciones N4 de una
        cohorte. Los pseudonimos de estudiantes se hashean con tu salt de investigacion.
      </p>
      <ul className="list-disc list-inside space-y-2 ml-4">
        <li>
          <strong>Comision (UUID):</strong> El identificador de la comision cuya cohorte vas a
          exportar. Obligatorio.
        </li>
        <li>
          <strong>Salt de anonimizacion:</strong> Clave de al menos 16 caracteres para hashear los
          pseudonimos. Con el mismo salt podras correlacionar datasets futuros con este.
        </li>
        <li>
          <strong>Periodo (dias):</strong> Ventana de tiempo hacia atras desde hoy. Por defecto 90
          dias.
        </li>
        <li>
          <strong>Alias de cohorte:</strong> Nombre libre que identifica el dataset en el archivo
          descargado (ej. UNSL_2026_P2).
        </li>
        <li>
          <strong>Incluir prompts:</strong> Incluye el texto de los prompts en el dataset. Activar
          solo si es necesario para el analisis — incrementa el riesgo de re-identificacion.
        </li>
        <li>
          <strong>Generar dataset:</strong> Encola el job. El panel de progreso muestra el estado en
          tiempo real; cuando llega a "Completado" aparece el boton de descarga.
        </li>
      </ul>
      <div className="bg-zinc-800 p-4 rounded-lg mt-4">
        <p className="text-orange-400 font-medium">Importante:</p>
        <p className="text-sm mt-1">
          Guarda el salt en un lugar seguro. Sin el mismo salt no podras correlacionar este dataset
          con exportaciones posteriores de la misma cohorte.
        </p>
      </div>
      <div className="bg-red-900/50 p-4 rounded-lg mt-2 border border-red-700">
        <p className="text-[var(--danger-text)] font-medium">Advertencia:</p>
        <p className="text-sm mt-1">
          Activar "Incluir prompts" expone texto libre que puede contener informacion
          re-identificable. Usarlo solo con aprobacion del comite de etica del piloto.
        </p>
      </div>
    </div>
  ),

  kappaRating: (
    <div className="space-y-4 text-zinc-300">
      <p className="text-lg font-medium text-[var(--text-inverse)]">
        Inter-rater Agreement (Kappa)
      </p>
      <p>
        Procedimiento intercoder para calcular el coeficiente Kappa de Cohen entre el juicio humano
        del docente y las predicciones del clasificador automatico N4. Target de la tesis: kappa ≥
        0.6.
      </p>
      <ul className="list-disc list-inside space-y-2 ml-4">
        <li>
          <strong>Episodios cargados:</strong> La lista muestra los episodios asignados al batch con
          la prediccion del modelo visible a la derecha.
        </li>
        <li>
          <strong>Etiquetar:</strong> Para cada episodio, selecciona tu propia clasificacion usando
          uno de los tres botones de categoria. La seleccion queda resaltada con un anillo azul.
        </li>
        <li>
          <strong>Delegacion pasiva:</strong> El estudiante delego la resolucion al tutor sin
          apropiacion real del conocimiento.
        </li>
        <li>
          <strong>Apropiacion superficial:</strong> El estudiante mostro comprension parcial o
          aplicacion mecanica sin profundidad.
        </li>
        <li>
          <strong>Apropiacion reflexiva:</strong> El estudiante demostro comprension profunda,
          pensamiento critico y autonomia.
        </li>
        <li>
          <strong>Calcular Kappa:</strong> Se habilita cuando todos los episodios estan etiquetados.
          Muestra el valor kappa, la interpretacion, la matriz de confusion y el acuerdo por clase.
        </li>
        <li>
          <strong>Reiniciar:</strong> Borra todas las etiquetas para empezar de nuevo.
        </li>
      </ul>
      <div className="bg-zinc-800 p-4 rounded-lg mt-4">
        <p className="text-orange-400 font-medium">Nota:</p>
        <p className="text-sm mt-1">
          Para el protocolo de tesis, dos docentes deben etiquetar de forma independiente el mismo
          batch de 50 episodios y luego comparar los resultados via kappa. Ver
          docs/pilot/kappa-workflow.md para el procedimiento completo.
        </p>
      </div>
    </div>
  ),

  materiales: (
    <div className="space-y-4 text-zinc-300">
      <p className="text-lg font-medium text-[var(--text-inverse)]">Materiales del Curso</p>
      <p>
        Gestion del corpus del RAG (Retrieval-Augmented Generation). Los materiales subidos son
        indexados automaticamente y el tutor socratico los usa para responder consultas de
        estudiantes.
      </p>
      <ul className="list-disc list-inside space-y-2 ml-4">
        <li>
          <strong>Subir material:</strong> Selecciona un archivo PDF, Markdown (.md), texto (.txt) o
          ZIP de codigo. Tamano maximo: 50 MB por archivo.
        </li>
        <li>
          <strong>Pipeline de indexacion:</strong> Cada archivo pasa por: Subido → Extrayendo texto
          → Particionando → Embeddings → Indexado. Los estados intermedios pulsan en la tabla.
        </li>
        <li>
          <strong>Indexado:</strong> El material esta disponible para el RAG. El numero de chunks se
          muestra en la columna "Chunks".
        </li>
        <li>
          <strong>Error:</strong> Algo fallo en el pipeline (ej. PDF corrupto, ZIP sin codigo
          valido). El mensaje de error aparece debajo del nombre del archivo.
        </li>
        <li>
          <strong>Eliminar:</strong> Soft delete. El RAG deja de usar ese material en consultas
          futuras; los episodios pasados no se modifican.
        </li>
        <li>
          <strong>Refrescar:</strong> Actualiza la lista manualmente. Los materiales en
          procesamiento se refrescan automaticamente cada 2 segundos.
        </li>
      </ul>
      <div className="bg-zinc-800 p-4 rounded-lg mt-4">
        <p className="text-orange-400 font-medium">Consejo:</p>
        <p className="text-sm mt-1">
          Subir el material antes de que los estudiantes empiecen a usarlo. El tutor solo puede
          citar material ya indexado (estado "Indexado").
        </p>
      </div>
    </div>
  ),

  progression: (
    <div className="space-y-4 text-zinc-300">
      <p className="text-lg font-medium text-[var(--text-inverse)]">Progresion Longitudinal</p>
      <p>
        Analisis de la trayectoria de aprendizaje de cada estudiante a lo largo del cuatrimestre,
        basado en las clasificaciones N4 de sus episodios.
      </p>
      <ul className="list-disc list-inside space-y-2 ml-4">
        <li>
          <strong>Mejorando:</strong> El estudiante muestra una tendencia positiva hacia Apropiacion
          Reflexiva en sus ultimos episodios.
        </li>
        <li>
          <strong>Estable:</strong> La clasificacion del estudiante no muestra una tendencia clara
          de mejora ni deterioro.
        </li>
        <li>
          <strong>Empeorando:</strong> Los ultimos episodios muestran regresion hacia categorias de
          menor apropiacion.
        </li>
        <li>
          <strong>Datos insuficientes:</strong> El estudiante tiene menos de 3 episodios
          clasificados — no hay datos suficientes para calcular tendencia.
        </li>
        <li>
          <strong>Net progression ratio:</strong> Indicador global de la cohorte. Rango [-1, +1]:
          positivo significa mas estudiantes mejorando que empeorando.
        </li>
        <li>
          <strong>Trayectorias individuales:</strong> Cada barra de colores representa un episodio
          clasificado en orden cronologico. Rojo = delegacion pasiva, ambar = superficial, verde =
          reflexiva.
        </li>
      </ul>
      <div className="bg-zinc-800 p-4 rounded-lg mt-4">
        <p className="text-orange-400 font-medium">Nota:</p>
        <p className="text-sm mt-1">
          Solo se muestran estudiantes con al menos 3 episodios clasificados en el campo "con datos
          suficientes". Los demas aparecen en "Insuficiente" en las tarjetas de resumen.
        </p>
      </div>
    </div>
  ),

  tareasPracticas: (
    <div className="space-y-4 text-zinc-300">
      <p className="text-lg font-medium text-[var(--text-inverse)]">Trabajos Practicos</p>
      <p>
        Gestion de los TPs de la comision. Solo los TPs en estado "Publicado" son visibles para los
        estudiantes y aceptan episodios del tutor socratico.
      </p>
      <ul className="list-disc list-inside space-y-2 ml-4">
        <li>
          <strong>Nuevo TP:</strong> Crea un TP en estado "Borrador". Completa codigo, titulo,
          enunciado en markdown, fechas opcionales y peso.
        </li>
        <li>
          <strong>Publicar:</strong> Transicion draft → published. Una vez publicado, el TP es
          inmutable — no se puede editar el enunciado.
        </li>
        <li>
          <strong>Nueva version:</strong> Forkea un TP publicado o archivado en un nuevo borrador
          con el mismo contenido, linkeado por parent_tarea_id.
        </li>
        <li>
          <strong>Archivar:</strong> Transicion published → archived. Los estudiantes no pueden
          enviar episodios a un TP archivado.
        </li>
        <li>
          <strong>Eliminar:</strong> Soft delete. Solo disponible en estado draft.
        </li>
        <li>
          <strong>Historial:</strong> Muestra la linea de tiempo de todas las versiones del TP con
          su estado y fecha de creacion.
        </li>
        <li>
          <strong>Ver:</strong> Detalle de lectura del TP publicado o archivado, con el enunciado
          renderizado en markdown.
        </li>
        <li>
          <strong>Badge "Plantilla":</strong> El TP fue auto-generado desde una plantilla de
          catedra. Si se edita directamente, se marca como "Drift" (perdio sincronizacion con la
          plantilla).
        </li>
        <li>
          <strong>Badge "Drift":</strong> El TP diverge de la plantilla de catedra. Nuevas versiones
          del template ya no se propagan automaticamente a esta instancia.
        </li>
      </ul>
      <div className="bg-zinc-800 p-4 rounded-lg mt-4">
        <p className="text-orange-400 font-medium">Nota:</p>
        <p className="text-sm mt-1">
          El orden correcto es: crear borrador → revisar → publicar. Una vez publicado, usar "Nueva
          version" para modificar el contenido sin invalidar los episodios ya registrados.
        </p>
      </div>
      <div className="bg-red-900/50 p-4 rounded-lg mt-2 border border-red-700">
        <p className="text-[var(--danger-text)] font-medium">Advertencia:</p>
        <p className="text-sm mt-1">
          Publicar un TP es irreversible en cuanto al contenido: el enunciado queda congelado.
          Archivar tambien es irreversible — los episodios en curso quedan suspendidos.
        </p>
      </div>
    </div>
  ),

  templates: (
    <div className="space-y-4 text-zinc-300">
      <p className="text-lg font-medium text-[var(--text-inverse)]">
        Plantillas de Trabajos Practicos
      </p>
      <p>
        Las plantillas de TP se definen a nivel de catedra (materia + periodo) y se instancian
        automaticamente en todas las comisiones de esa materia. Esto asegura que los estudiantes de
        comisiones distintas reciben el mismo material y que la catedra edita en un solo lugar.
      </p>
      <ul className="list-disc list-inside space-y-2 ml-4">
        <li>
          <strong>Contexto academico:</strong> Selecciona universidad, facultad, carrera, plan,
          materia y periodo. Las plantillas viven a nivel (materia, periodo).
        </li>
        <li>
          <strong>Crear plantilla:</strong> Define codigo, titulo y enunciado markdown. Al guardar,
          el sistema crea automaticamente una TP (instancia) en cada comision de la materia.
        </li>
        <li>
          <strong>Ver instancias:</strong> Lista cada comision donde existe una instancia, con badge
          "Sincronizada" o "Drift" segun si el docente local edito la instancia.
        </li>
        <li>
          <strong>Publicar plantilla:</strong> Marca el template como published (luz verde de la
          catedra). No publica automaticamente las instancias — cada comision decide.
        </li>
        <li>
          <strong>Nueva version:</strong> Crea v+1 del template en borrador. Con "Re-instanciar
          comisiones sin drift" activado, las instancias que aun siguen al template reciben la nueva
          version automaticamente.
        </li>
        <li>
          <strong>Archivar / Eliminar:</strong> Soft delete. Las instancias existentes en comisiones
          no se tocan (preservan evidencia CTR).
        </li>
      </ul>
      <div className="bg-zinc-800 p-4 rounded-lg mt-4">
        <p className="text-orange-400 font-medium">Que es "Drift":</p>
        <p className="text-sm mt-1">
          Drift ocurre cuando el docente de una comision edita una instancia de TP que vino del
          template. El link al template se preserva pero la auto-actualizacion se desactiva. Esto
          permite personalizar por comision sin perder trazabilidad. Una vez drifteada, la instancia
          no recibe mas versiones automaticas del template.
        </p>
      </div>
      <div className="bg-red-900/50 p-4 rounded-lg mt-2 border border-red-700">
        <p className="text-[var(--danger-text)] font-medium">Advertencia:</p>
        <p className="text-sm mt-1">
          Eliminar una plantilla es soft delete: las instancias ya creadas en comisiones NO se
          borran (evidencia del CTR queda intacta). Publicar es reversible solo via archivar.
        </p>
      </div>
    </div>
  ),
}
