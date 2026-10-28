
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  Footer,
  PageNumber,
  BorderStyle
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
let versionVistaPrevia = 0;

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
    let solicitud;

    try {
      solicitud = operacion(
        tx.objectStore(almacen)
      );
    } catch (error) {
      tx.abort();
      reject(error);
      return;
    }

    tx.oncomplete = () => {
      db.close();
      resolve(solicitud?.result);
    };

    tx.onerror = () => {
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

function guardarRegistro(almacen, datos) {
  return ejecutarTransaccion(
    almacen,
    "readwrite",
    store => store.put(datos)
  );
}

function obtenerRegistros(almacen) {
  return ejecutarTransaccion(
    almacen,
    "readonly",
    store => store.getAll()
  );
}

function eliminarRegistro(almacen, id) {
  return ejecutarTransaccion(
    almacen,
    "readwrite",
    store => store.delete(id)
  );
}

async function fotosDelProyecto() {
  if (!proyectoActivo) return [];

  return (await obtenerRegistros("fotografias"))
    .filter(f => f.proyectoId === proyectoActivo)
    .sort((a, b) => a.orden - b.orden);
}

async function proyectoActual() {
  if (!proyectoActivo) return null;

  const proyectos = await obtenerRegistros(
    "proyectos"
  );

  return proyectos.find(
    p => p.id === proyectoActivo
  ) || null;
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

    boton.onclick = () => {
      abrirProyecto(proyecto).catch(console.error);
    };

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

    datos.id =
      proyectoActivo || crypto.randomUUID();

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
// 6. CAPTURA Y CARGA DE IMÁGENES
// ========================================

$("btnCamara").onclick = () => {
  if (!proyectoActivo) {
    mostrarMensaje(
      "Primero guarde o abra una fiscalización"
    );
    return;
  }

  $("inputCamara").click();
};

$("btnAgregar").onclick = () => {
  if (!proyectoActivo) {
    mostrarMensaje(
      "Primero guarde o abra una fiscalización"
    );
    return;
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
    mostrarMensaje(
      "No se seleccionaron imágenes válidas"
    );
    return;
  }

  const titulo = document.createElement("h3");
  titulo.textContent =
    "Vista previa antes de guardar";

  vista.append(titulo);

  for (const archivo of archivosPendientes) {
    const imagen = document.createElement("img");
    const url = URL.createObjectURL(archivo);

    imagen.src = url;
    imagen.alt = "Fotografía pendiente";

    imagen.onload = () => {
      URL.revokeObjectURL(url);
    };

    imagen.onerror = () => {
      URL.revokeObjectURL(url);
    };

    vista.append(imagen);
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
      (maximo, foto) =>
        Math.max(maximo, foto.orden || 0),
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

  if (!fotos.some(
    foto => foto.id === fotoSeleccionadaId
  )) {
    fotoSeleccionadaId = null;
  }

  fotos.forEach((foto, indice) => {
    const tarjeta = document.createElement("div");
    tarjeta.className = "tarjeta";
    tarjeta.style.cursor = "pointer";

    const titulo = document.createElement("h3");

    titulo.textContent =
      `Foto N.º ${String(indice + 1).padStart(2, "0")}`;

    const imagen = document.createElement("img");
    const url = URL.createObjectURL(foto.imagen);

    imagen.src = url;
    imagen.alt = titulo.textContent;

    imagen.onload = () => {
      URL.revokeObjectURL(url);
    };

    imagen.onerror = () => {
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

          await actualizarVistaAnexo();

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
      imagen,
      etiqueta,
      descripcion
    );

    galeria.append(tarjeta);
  });

  actualizarSeleccion(fotos);

  await actualizarVistaAnexo();
}

// ========================================
// 10. SELECCIÓN DE FOTOGRAFÍAS
// ========================================

function actualizarSeleccion(fotos) {
  const indice = fotos.findIndex(
    foto => foto.id === fotoSeleccionadaId
  );

  $("galeria")
    .querySelectorAll(".tarjeta")
    .forEach((tarjeta, posicion) => {
      tarjeta.classList.toggle(
        "foto-seleccionada",
        posicion === indice
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
      foto => foto.id === id
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
  if (!confirm(
    "¿Está seguro de eliminar esta fotografía?"
  )) {
    return;
  }

  try {
    await eliminarRegistro("fotografias", id);

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
// 14. VISTA PREVIA COMPLETA DEL ANEXO
// ========================================

async function actualizarVistaAnexo() {
  const version = ++versionVistaPrevia;
  const vista = $("vistaAnexo");

  const proyecto = await proyectoActual();
  const fotos = await fotosDelProyecto();

  if (version !== versionVistaPrevia) {
    return;
  }

  vista.replaceChildren();

  if (!proyecto) {
    vista.textContent =
      "Abra una fiscalización para visualizar el anexo.";
    return;
  }

  const titulo = document.createElement("h3");
  titulo.textContent =
    "ANEXO 2 - REGISTRO FOTOGRÁFICO";

  vista.append(titulo);

  const campos = [
    ["Código", proyecto.codigo],
    ["Fecha", proyecto.fecha],
    ["Lugar", proyecto.lugar],
    ["Fiscalizador", proyecto.fiscalizador],
    ["Establecimiento", proyecto.establecimiento]
  ];

  for (const [nombre, valor] of campos) {
    const parrafo = document.createElement("p");

    const etiqueta = document.createElement("strong");
    etiqueta.textContent = nombre + ": ";

    const dato = document.createElement("span");
    dato.textContent = valor || "";

    parrafo.append(etiqueta, dato);
    vista.append(parrafo);
  }

  if (!fotos.length) {
    const aviso = document.createElement("p");
    aviso.textContent =
      "Todavía no hay fotografías registradas.";

    vista.append(aviso);
    return;
  }

  for (const [indice, foto] of fotos.entries()) {
    const tarjeta = document.createElement("div");

    tarjeta.style.cssText = `
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 14px;
      margin: 14px 0;
      background: white;
    `;

    const imagen = document.createElement("img");
    const url = URL.createObjectURL(foto.imagen);

    imagen.src = url;
    imagen.alt = `Foto ${indice + 1}`;

    imagen.style.cssText = `
      display: block;
      width: 100%;
      max-height: 290px;
      object-fit: contain;
      margin-bottom: 12px;
    `;

    imagen.onload = () => {
      URL.revokeObjectURL(url);
    };

    imagen.onerror = () => {
      URL.revokeObjectURL(url);
    };

    const detalle = document.createElement("p");

    const numero = document.createElement("strong");
    numero.textContent =
      `Foto N.º ${String(indice + 1).padStart(2, "0")}: `;

    const descripcion = document.createElement("span");

    descripcion.textContent =
      foto.descripcion?.trim() ||
      "PENDIENTE DE DESCRIPCIÓN";

    detalle.append(numero, descripcion);
    tarjeta.append(imagen, detalle);
    vista.append(tarjeta);
  }
}

// ========================================
// 15. PREPARAR IMAGEN PARA WORD
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

    const escalaWord = Math.min(
      440 / canvas.width,
      190 / canvas.height
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
// 16. EXPORTACIÓN WORD PROFESIONAL
// ========================================

async function generarWord() {
  const boton = $("btnWord");

  if (boton.disabled) return;

  boton.disabled = true;

  try {
    const proyecto = await proyectoActual();

    if (!proyecto) {
      mostrarMensaje(
        "Primero guarde o abra una fiscalización"
      );
      return;
    }

    const campos = [
      ["Código", proyecto.codigo],
      ["Fecha", proyecto.fecha],
      ["Lugar", proyecto.lugar],
      ["Fiscalizador", proyecto.fiscalizador],
      ["Establecimiento", proyecto.establecimiento]
    ];

    // VALIDACIÓN DE DATOS OBLIGATORIOS
    const faltantes = campos
      .filter(([, valor]) =>
        !String(valor || "").trim()
      )
      .map(([nombre]) => nombre);

    if (faltantes.length) {
      mostrarMensaje(
        "Complete los datos obligatorios: " +
        faltantes.join(", ")
      );
      return;
    }

    const fotos = await fotosDelProyecto();

    if (!fotos.length) {
      mostrarMensaje(
        "Debe agregar fotografías antes de exportar."
      );
      return;
    }

    // VALIDACIÓN DE DESCRIPCIONES
    const sinDescripcion = fotos
      .map((foto, indice) => ({
        numero: indice + 1,
        descripcion: foto.descripcion
      }))
      .filter(foto =>
        !String(foto.descripcion || "").trim()
      )
      .map(foto => foto.numero);

    if (sinDescripcion.length) {
      mostrarMensaje(
        "Complete la descripción de las fotos: " +
        sinDescripcion.join(", ")
      );
      return;
    }

    const fuente = "Poppins";
    const tamano = 16; // 8 puntos
    const contenido = [];

    function parrafo(texto, negrita = false) {
      return new Paragraph({
        spacing: { after: 60 },
        children: [
          new TextRun({
            text: String(texto),
            bold: negrita,
            font: fuente,
            size: tamano,
            color: "202020"
          })
        ]
      });
    }

    // TÍTULO PRINCIPAL
    contenido.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 170 },
        children: [
          new TextRun({
            text: "ANEXO 2 - REGISTRO FOTOGRÁFICO",
            bold: true,
            font: fuente,
            size: 22,
            color: "202020"
          })
        ]
      })
    );

    // INFORMACIÓN DE LA FISCALIZACIÓN
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
              text: String(valor),
              font: fuente,
              size: tamano
            })
          ]
        })
      );
    }

    // FECHA DEL ANEXO
    const partes = String(proyecto.fecha).split("-");

    const fechaLegible = partes.length === 3
      ? `${partes[2]}/${partes[1]}/${partes[0]}`
      : String(proyecto.fecha);

    contenido.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: {
          before: 180,
          after: 180
        },
        children: [
          new TextRun({
            text: `FOTOGRAFÍAS DE FECHA ${fechaLegible}`,
            bold: true,
            font: fuente,
            size: 18,
            color: "202020"
          })
        ]
      })
    );

    // CONFIGURACIÓN DE TABLAS
    const bordes = {
      top: {
        style: BorderStyle.SINGLE,
        size: 4,
        color: "CBD5E1"
      },
      bottom: {
        style: BorderStyle.SINGLE,
        size: 4,
        color: "CBD5E1"
      },
      left: {
        style: BorderStyle.SINGLE,
        size: 4,
        color: "CBD5E1"
      },
      right: {
        style: BorderStyle.SINGLE,
        size: 4,
        color: "CBD5E1"
      }
    };

    // DOS FOTOGRAFÍAS POR BLOQUE DE PÁGINA
    for (let inicio = 0; inicio < fotos.length; inicio += 2) {
      if (inicio > 0) {
        contenido.push(
          new Paragraph({
            pageBreakBefore: true,
            spacing: { after: 0 },
            children: []
          })
        );
      }

      const filas = [];

      const grupo = fotos.slice(inicio, inicio + 2);

      for (const [posicion, foto] of grupo.entries()) {
        const indice = inicio + posicion;

        const numero = String(
          indice + 1
        ).padStart(2, "0");

        const imagen = await prepararImagenWord(
          foto.imagen
        );

        // FILA COMBINADA PARA LA IMAGEN
        filas.push(
          new TableRow({
            cantSplit: true,
            children: [
              new TableCell({
                columnSpan: 2,
                width: {
                  size: 8900,
                  type: WidthType.DXA
                },
                borders: bordes,
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    spacing: {
                      before: 80,
                      after: 80
                    },
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
                ]
              })
            ]
          })
        );

        // FILA DE NÚMERO Y DESCRIPCIÓN
        filas.push(
          new TableRow({
            cantSplit: true,
            children: [
              new TableCell({
                width: {
                  size: 1800,
                  type: WidthType.DXA
                },
                borders: bordes,
                children: [
                  parrafo(
                    `Foto N.º ${numero}`,
                    true
                  )
                ]
              }),

              new TableCell({
                width: {
                  size: 7100,
                  type: WidthType.DXA
                },
                borders: bordes,
                children: [
                  parrafo(
                    foto.descripcion.trim()
                  )
                ]
              })
            ]
          })
        );
      }

      contenido.push(
        new Table({
          width: {
            size: 8900,
            type: WidthType.DXA
          },
          columnWidths: [1800, 7100],
          rows: filas
        })
      );
    }

    // DOCUMENTO A4 VERTICAL
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

    // GENERAR ARCHIVO DOCX
    const archivo = await Packer.toBlob(documento);

    const codigoSeguro = String(proyecto.codigo)
      .replace(/[^a-zA-Z0-9_-]/g, "_");

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
      "Error al generar Word. Revise la consola."
    );
  } finally {
    boton.disabled = false;
  }
}

// ========================================
// 17. ACTIVAR BOTÓN WORD
// ========================================

$("btnWord").addEventListener(
  "click",
  generarWord
);

// ========================================
// 18. INICIALIZAR APLICACIÓN
// ========================================

async function iniciarAplicacion() {
  try {
    const db = await abrirBaseDatos();
    db.close();

    console.log(
      "IndexedDB inicializada correctamente"
    );

    await listarProyectos();
    await mostrarGaleria();

    console.log(
      "Sistema de fiscalización iniciado"
    );
  } catch (error) {
    console.error(error);

    mostrarMensaje(
      "Error al iniciar la aplicación"
    );
  }
}

iniciarAplicacion();
