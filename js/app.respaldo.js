
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  AlignmentType,
  Footer,
  PageNumber
} from "docx";

import { saveAs } from "file-saver";

// ========================================
// 1. CONFIGURACIÓN GENERAL
// ========================================

const DB_NOMBRE = "FiscalizacionDB";
const DB_VERSION = 1;

let proyectoActivo = null;
let archivosPendientes = [];
let fotoSeleccionadaId = null;

const $ = id => document.getElementById(id);

function mostrarMensaje(texto) {
  $("mensaje").textContent = texto;
}

// ========================================
// 2. BASE DE DATOS INDEXEDDB
// ========================================

function abrirBaseDatos() {
  return new Promise((resolve, reject) => {
    const solicitud = indexedDB.open(
      DB_NOMBRE,
      DB_VERSION
    );

    solicitud.onupgradeneeded = () => {
      const db = solicitud.result;

      if (!db.objectStoreNames.contains("proyectos")) {
        db.createObjectStore("proyectos", {
          keyPath: "id"
        });
      }

      if (!db.objectStoreNames.contains("fotografias")) {
        const almacen = db.createObjectStore(
          "fotografias",
          { keyPath: "id" }
        );

        almacen.createIndex(
          "proyectoId",
          "proyectoId"
        );
      }
    };

    solicitud.onsuccess = () => {
      resolve(solicitud.result);
    };

    solicitud.onerror = () => {
      reject(solicitud.error);
    };
  });
}

async function ejecutarTransaccion(
  almacen,
  modo,
  operacion
) {
  const db = await abrirBaseDatos();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(almacen, modo);
    let resultado;

    try {
      resultado = operacion(
        tx.objectStore(almacen)
      );
    } catch (error) {
      db.close();
      reject(error);
      return;
    }

    tx.oncomplete = () => {
      db.close();
      resolve(resultado?.result);
    };

    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };

    tx.onabort = () => {
      db.close();
      reject(
        tx.error ||
        new Error("Transacción cancelada")
      );
    };
  });
}

const guardarRegistro = (almacen, datos) =>
  ejecutarTransaccion(
    almacen,
    "readwrite",
    store => store.put(datos)
  );

const obtenerRegistros = almacen =>
  ejecutarTransaccion(
    almacen,
    "readonly",
    store => store.getAll()
  );

const eliminarRegistro = (almacen, id) =>
  ejecutarTransaccion(
    almacen,
    "readwrite",
    store => store.delete(id)
  );

async function fotosDelProyecto() {
  if (!proyectoActivo) return [];

  return (await obtenerRegistros("fotografias"))
    .filter(f => f.proyectoId === proyectoActivo)
    .sort((a, b) => a.orden - b.orden);
}

// ========================================
// 3. LISTAR PROYECTOS
// ========================================

async function listarProyectos() {
  const lista = $("listaProyectos");
  lista.replaceChildren();

  const proyectos = await obtenerRegistros(
    "proyectos"
  );

  for (const proyecto of proyectos) {
    const tarjeta = document.createElement("div");
    tarjeta.className = "tarjeta";

    const titulo = document.createElement("h3");
    titulo.textContent = proyecto.codigo;

    const lugar = document.createElement("p");
    lugar.textContent = proyecto.lugar;

    const boton = document.createElement("button");
    boton.type = "button";
    boton.textContent = "Abrir proyecto";

    boton.onclick = () => abrirProyecto(proyecto);

    tarjeta.append(titulo, lugar, boton);
    lista.append(tarjeta);
  }
}

// ========================================
// 4. ABRIR PROYECTO
// ========================================

async function abrirProyecto(proyecto) {
  proyectoActivo = proyecto.id;
  fotoSeleccionadaId = null;
  archivosPendientes = [];

  const campos = [
    "codigo",
    "fecha",
    "lugar",
    "fiscalizador",
    "establecimiento"
  ];

  for (const campo of campos) {
    $(campo).value = proyecto[campo] || "";
  }

  $("vistaCaptura").replaceChildren();
  $("vistaAnexo").replaceChildren();

  await mostrarGaleria();

  mostrarMensaje(
    "Proyecto abierto: " + proyecto.codigo
  );
}

// ========================================
// 5. GUARDAR FISCALIZACIÓN
// ========================================

$("formProyecto").addEventListener(
  "submit",
  async evento => {
    evento.preventDefault();

    const datos = {};

    const campos = [
      "codigo",
      "fecha",
      "lugar",
      "fiscalizador",
      "establecimiento"
    ];

    for (const campo of campos) {
      datos[campo] = $(campo).value.trim();

      if (!datos[campo]) {
        mostrarMensaje(
          "Complete el campo: " + campo
        );
        return;
      }
    }

    datos.id = proyectoActivo || crypto.randomUUID();

    try {
      await guardarRegistro("proyectos", datos);

      proyectoActivo = datos.id;

      await listarProyectos();
      await mostrarGaleria();

      mostrarMensaje(
        "Fiscalización guardada correctamente"
      );
    } catch (error) {
      console.error(error);

      mostrarMensaje(
        "Error al guardar la fiscalización"
      );
    }
  }
);

// ========================================
// 6. CAPTURAR Y AGREGAR FOTOGRAFÍAS
// ========================================

$("btnCamara").onclick = () => {
  if (!proyectoActivo) {
    return mostrarMensaje(
      "Primero guarde o abra una fiscalización"
    );
  }

  $("inputCamara").click();
};

$("btnAgregar").onclick = () => {
  if (!proyectoActivo) {
    return mostrarMensaje(
      "Primero guarde o abra una fiscalización"
    );
  }

  $("inputImagenes").click();
};

function prepararImagenes(archivos) {
  archivosPendientes = Array.from(archivos)
    .filter(archivo =>
      archivo.type.startsWith("image/")
    );

  const vista = $("vistaCaptura");
  vista.replaceChildren();

  if (!archivosPendientes.length) {
    return mostrarMensaje(
      "No se seleccionaron imágenes válidas"
    );
  }

  const titulo = document.createElement("h3");
  titulo.textContent = "Vista previa antes de guardar";

  vista.append(titulo);

  for (const archivo of archivosPendientes) {
    const img = document.createElement("img");
    const url = URL.createObjectURL(archivo);

    img.src = url;
    img.alt = "Fotografía pendiente";

    img.onload = () => {
      URL.revokeObjectURL(url);
    };

    vista.append(img);
  }

  const confirmar = document.createElement("button");
  confirmar.type = "button";
  confirmar.textContent =
    "Confirmar y guardar fotografías";

  confirmar.onclick = guardarFotografias;

  const cancelar = document.createElement("button");
  cancelar.type = "button";
  cancelar.textContent = "Cancelar";

  cancelar.onclick = () => {
    archivosPendientes = [];
    vista.replaceChildren();

    mostrarMensaje(
      "Incorporación cancelada"
    );
  };

  vista.append(confirmar, cancelar);
}

for (const id of ["inputCamara", "inputImagenes"]) {
  $(id).addEventListener("change", evento => {
    prepararImagenes(evento.target.files);
    evento.target.value = "";
  });
}

// ========================================
// 7. GUARDAR FOTOGRAFÍAS
// ========================================

async function guardarFotografias() {
  if (
    !proyectoActivo ||
    !archivosPendientes.length
  ) {
    return;
  }

  try {
    const existentes = await fotosDelProyecto();

    let orden = existentes.reduce(
      (max, foto) =>
        Math.max(max, foto.orden || 0),
      0
    );

    for (const archivo of archivosPendientes) {
      await guardarRegistro("fotografias", {
        id: crypto.randomUUID(),
        proyectoId: proyectoActivo,
        imagen: archivo,
        descripcion: "",
        incorporadaEn: new Date().toISOString(),
        orden: ++orden
      });
    }

    archivosPendientes = [];

    $("vistaCaptura").replaceChildren();

    await mostrarGaleria();

    mostrarMensaje(
      "Fotografías guardadas correctamente"
    );
  } catch (error) {
    console.error(error);

    mostrarMensaje(
      "Error al guardar fotografías"
    );
  }
}

// ========================================
// 8. BARRA DE HERRAMIENTAS
// ========================================

const barraFotos = document.createElement("div");
barraFotos.id = "barraFotos";

barraFotos.innerHTML = `
  <button type="button" id="subirSeleccionada">
    ↑ Subir
  </button>
  <button type="button" id="bajarSeleccionada">
    ↓ Bajar
  </button>
  <button type="button" id="eliminarSeleccionada">
    Eliminar
  </button>
  <span id="estadoSeleccion">
    Ninguna fotografía seleccionada
  </span>
`;

$("galeria").before(barraFotos);

// ========================================
// 9. MOSTRAR GALERÍA
// ========================================

async function mostrarGaleria() {
  const galeria = $("galeria");
  galeria.replaceChildren();

  const fotos = await fotosDelProyecto();

  if (
    !fotos.some(f => f.id === fotoSeleccionadaId)
  ) {
    fotoSeleccionadaId = null;
  }

  fotos.forEach((foto, indice) => {
    const tarjeta = document.createElement("div");
    tarjeta.className = "tarjeta";
    tarjeta.style.cursor = "pointer";

    tarjeta.classList.toggle(
      "foto-seleccionada",
      foto.id === fotoSeleccionadaId
    );

    const titulo = document.createElement("h3");

    titulo.textContent =
      `Foto N.º ${String(indice + 1).padStart(2, "0")}`;

    const img = document.createElement("img");
    const url = URL.createObjectURL(foto.imagen);

    img.src = url;
    img.alt = titulo.textContent;

    img.onload = () => {
      URL.revokeObjectURL(url);
    };

    const etiqueta = document.createElement("label");
    etiqueta.textContent = "Descripción";

    const descripcion = document.createElement("textarea");

    descripcion.value = foto.descripcion || "";
    descripcion.placeholder =
      "Describa la fotografía";

    descripcion.addEventListener(
      "change",
      async () => {
        try {
          foto.descripcion =
            descripcion.value.trim();

          await guardarRegistro(
            "fotografias",
            foto
          );

          mostrarMensaje(
            "Descripción guardada"
          );
        } catch (error) {
          console.error(error);

          mostrarMensaje(
            "Error al guardar descripción"
          );
        }
      }
    );

    tarjeta.onclick = evento => {
      if (evento.target.closest("textarea")) {
        return;
      }

      fotoSeleccionadaId = foto.id;
      actualizarSeleccion(fotos);
    };

    tarjeta.append(
      titulo,
      img,
      etiqueta,
      descripcion
    );

    galeria.append(tarjeta);
  });

  actualizarSeleccion(fotos);
}

// ========================================
// 10. SELECCIONAR FOTOGRAFÍA
// ========================================

function actualizarSeleccion(fotos) {
  const indice = fotos.findIndex(
    f => f.id === fotoSeleccionadaId
  );

  $("galeria")
    .querySelectorAll(".tarjeta")
    .forEach((tarjeta, i) => {
      tarjeta.classList.toggle(
        "foto-seleccionada",
        i === indice
      );
    });

  $("estadoSeleccion").textContent =
    indice >= 0
      ? `Foto N.º ${String(indice + 1).padStart(2, "0")} seleccionada`
      : "Ninguna fotografía seleccionada";

  $("subirSeleccionada").disabled =
    indice <= 0;

  $("bajarSeleccionada").disabled =
    indice < 0 ||
    indice === fotos.length - 1;

  $("eliminarSeleccionada").disabled =
    indice < 0;
}

// ========================================
// 11. REORDENAR FOTOGRAFÍAS
// ========================================

async function moverFotografia(id, direccion) {
  try {
    const fotos = await fotosDelProyecto();

    const indice = fotos.findIndex(
      f => f.id === id
    );

    const destino = indice + direccion;

    if (
      indice < 0 ||
      destino < 0 ||
      destino >= fotos.length
    ) {
      return;
    }

    const actual = fotos[indice];
    const otra = fotos[destino];

    const ordenAnterior = actual.orden;

    actual.orden = otra.orden;
    otra.orden = ordenAnterior;

    await ejecutarTransaccion(
      "fotografias",
      "readwrite",
      store => {
        store.put(actual);
        store.put(otra);
      }
    );

    await mostrarGaleria();

    mostrarMensaje(
      "Orden actualizado correctamente"
    );
  } catch (error) {
    console.error(error);

    mostrarMensaje(
      "Error al cambiar el orden"
    );
  }
}

// ========================================
// 12. ELIMINAR FOTOGRAFÍA
// ========================================

async function eliminarFotografia(id) {
  if (
    !confirm(
      "¿Está seguro de eliminar esta fotografía?"
    )
  ) {
    return;
  }

  try {
    await eliminarRegistro(
      "fotografias",
      id
    );

    fotoSeleccionadaId = null;

    await mostrarGaleria();

    mostrarMensaje(
      "Fotografía eliminada correctamente"
    );
  } catch (error) {
    console.error(error);

    mostrarMensaje(
      "Error al eliminar fotografía"
    );
  }
}

// ========================================
// 13. BOTONES DE LA BARRA
// ========================================

$("subirSeleccionada").onclick = () => {
  if (fotoSeleccionadaId) {
    moverFotografia(fotoSeleccionadaId, -1);
  }
};

$("bajarSeleccionada").onclick = () => {
  if (fotoSeleccionadaId) {
    moverFotografia(fotoSeleccionadaId, 1);
  }
};

$("eliminarSeleccionada").onclick = () => {
  if (fotoSeleccionadaId) {
    eliminarFotografia(fotoSeleccionadaId);
  }
};

// ========================================
// 14. PREPARAR IMÁGENES PARA WORD
// ========================================

async function prepararImagenWord(archivo) {
  const bitmap = await createImageBitmap(archivo);

  try {
    const escala = Math.min(
      1,
      1000 / bitmap.width,
      700 / bitmap.height
    );

    const canvas = document.createElement("canvas");

    canvas.width = Math.max(
      1,
      Math.round(bitmap.width * escala)
    );

    canvas.height = Math.max(
      1,
      Math.round(bitmap.height * escala)
    );

    canvas.getContext("2d").drawImage(
      bitmap,
      0,
      0,
      canvas.width,
      canvas.height
    );

    const blob = await new Promise(resolve => {
      canvas.toBlob(resolve, "image/png");
    });

    if (!blob) {
      throw new Error(
        "No se pudo procesar una fotografía"
      );
    }

    const datos = new Uint8Array(
      await blob.arrayBuffer()
    );

    // Tamaño máximo para dos fotos por página
    const escalaWord = Math.min(
      470 / canvas.width,
      215 / canvas.height
    );

    return {
      datos,
      ancho: Math.max(
        1,
        Math.round(canvas.width * escalaWord)
      ),
      alto: Math.max(
        1,
        Math.round(canvas.height * escalaWord)
      )
    };
  } finally {
    bitmap.close();
  }
}

// ========================================
// 15. GENERAR DOCUMENTO WORD
// ========================================

async function generarWord() {
  if (!proyectoActivo) {
    mostrarMensaje(
      "Primero abra una fiscalización"
    );
    return;
  }

  const boton = $("btnWord");
  boton.disabled = true;

  try {
    const proyectos = await obtenerRegistros(
      "proyectos"
    );

    const proyecto = proyectos.find(
      p => p.id === proyectoActivo
    );

    if (!proyecto) {
      throw new Error(
        "Proyecto no encontrado"
      );
    }

    const fotos = await fotosDelProyecto();

    if (!fotos.length) {
      mostrarMensaje(
        "Agregue fotografías antes de generar Word"
      );
      return;
    }

    const fuente = "Poppins";
    const tamano = 16; // 8 puntos
    const contenido = [];

    // Título principal
    contenido.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
        children: [
          new TextRun({
            text: "ANEXO FOTOGRÁFICO DE FISCALIZACIÓN",
            bold: true,
            font: fuente,
            size: 22,
            color: "202020"
          })
        ]
      })
    );

    // Datos de fiscalización
    const campos = [
      ["Código de práctica", proyecto.codigo],
      ["Fecha", proyecto.fecha],
      ["Lugar", proyecto.lugar],
      ["Fiscalizador", proyecto.fiscalizador],
      ["Establecimiento", proyecto.establecimiento]
    ];

    for (const [nombre, valor] of campos) {
      contenido.push(
        new Paragraph({
          spacing: { after: 65 },
          children: [
            new TextRun({
              text: nombre + ": ",
              bold: true,
              font: fuente,
              size: tamano
            }),
            new TextRun({
              text: String(valor || ""),
              font: fuente,
              size: tamano
            })
          ]
        })
      );
    }

    // Subtítulo
    contenido.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: {
          before: 170,
          after: 130
        },
        children: [
          new TextRun({
            text: "REGISTRO DE EVIDENCIAS FOTOGRÁFICAS",
            bold: true,
            font: fuente,
            size: 18,
            color: "202020"
          })
        ]
      })
    );

    // Fotografías
    for (const [indice, foto] of fotos.entries()) {
      const numero = String(
        indice + 1
      ).padStart(2, "0");

      const imagen = await prepararImagenWord(
        foto.imagen
      );

      // Nueva página después de cada par de fotos
      contenido.push(
        new Paragraph({
          pageBreakBefore:
            indice > 0 && indice % 2 === 0,
          keepNext: true,
          spacing: {
            before: 110,
            after: 65
          },
          children: [
            new TextRun({
              text: `Fotografía N.º ${numero}`,
              bold: true,
              font: fuente,
              size: tamano
            })
          ]
        })
      );

      // Imagen centrada
      contenido.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          keepNext: true,
          spacing: { after: 75 },
          children: [
            new ImageRun({
              data: imagen.datos,
              type: "png",
              transformation: {
                width: imagen.ancho,
                height: imagen.alto
              }
            })
          ]
        })
      );

      // Descripción
      contenido.push(
        new Paragraph({
          keepLines: true,
          spacing: { after: 145 },
          children: [
            new TextRun({
              text: "Descripción: ",
              bold: true,
              font: fuente,
              size: tamano
            }),
            new TextRun({
              text:
                foto.descripcion ||
                "Sin descripción",
              font: fuente,
              size: tamano
            })
          ]
        })
      );
    }

    // ====================================
    // 16. CONFIGURACIÓN A4 Y PAGINACIÓN
    // ====================================

    const documento = new Document({
      styles: {
        default: {
          document: {
            run: {
              font: fuente,
              size: tamano
            }
          }
        }
      },

      sections: [
        {
          properties: {
            page: {
              size: {
                width: 11906,
                height: 16838
              },
              margin: {
                top: 1440,
                bottom: 1440,
                left: 1440,
                right: 1440
              }
            }
          },

          footers: {
            default: new Footer({
              children: [
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  children: [
                    new TextRun({
                      text: "Página ",
                      font: fuente,
                      size: 14
                    }),
                    new TextRun({
                      children: [
                        PageNumber.CURRENT
                      ],
                      font: fuente,
                      size: 14
                    })
                  ]
                })
              ]
            })
          },

          children: contenido
        }
      ]
    });

    // Crear y descargar Word
    const archivo = await Packer.toBlob(
      documento
    );

    const codigoSeguro = String(
      proyecto.codigo
    ).replace(
      /[^a-zA-Z0-9_-]/g,
      "_"
    );

    saveAs(
      archivo,
      `Anexo_Fotografico_${codigoSeguro}.docx`
    );

    mostrarMensaje(
      "Documento Word generado correctamente"
    );
  } catch (error) {
    console.error(error);

    mostrarMensaje(
      "Error al generar el documento Word"
    );
  } finally {
    boton.disabled = false;
  }
}

// ========================================
// 17. ACTIVAR EXPORTACIÓN
// ========================================

$("btnWord").addEventListener(
  "click",
  generarWord
);

// ========================================
// 18. INICIALIZAR APLICACIÓN
// ========================================

abrirBaseDatos()
  .then(db => {
    db.close();
    console.log(
      "IndexedDB inicializada correctamente"
    );
  })
  .catch(console.error);

listarProyectos().catch(console.error);

mostrarGaleria().catch(console.error);
