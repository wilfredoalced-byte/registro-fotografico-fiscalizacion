const DB_NOMBRE = "FiscalizacionDB";
const DB_VERSION = 1;

function abrirBaseDatos() {
  return new Promise((resolve, reject) => {
    const solicitud = indexedDB.open(DB_NOMBRE, DB_VERSION);

    solicitud.onupgradeneeded = (evento) => {
      const db = evento.target.result;

      if (!db.objectStoreNames.contains("proyectos")) {
        db.createObjectStore("proyectos", { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains("fotografias")) {
        const almacen = db.createObjectStore("fotografias", {
          keyPath: "id"
        });
        almacen.createIndex("proyectoId", "proyectoId");
      }
    };

    solicitud.onsuccess = () => resolve(solicitud.result);
    solicitud.onerror = () => reject(solicitud.error);
  });
}

abrirBaseDatos()
  .then(() => console.log("IndexedDB inicializada correctamente"))
  .catch(error => console.error("Error de IndexedDB:", error));

let proyectoActivo = null;

function mostrarMensaje(texto) {
  document.getElementById("mensaje").textContent = texto;
}

function guardarRegistro(almacen, datos) {
  return abrirBaseDatos().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(almacen, "readwrite");
    tx.objectStore(almacen).put(datos);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  }));
}

function obtenerRegistros(almacen) {
  return abrirBaseDatos().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(almacen, "readonly");
    const solicitud = tx.objectStore(almacen).getAll();
    solicitud.onsuccess = () => resolve(solicitud.result);
    solicitud.onerror = () => reject(solicitud.error);
    tx.oncomplete = () => db.close();
  }));
}

async function listarProyectos() {
  const proyectos = await obtenerRegistros("proyectos");
  const lista = document.getElementById("listaProyectos");
  lista.replaceChildren();

  for (const proyecto of proyectos) {
    const tarjeta = document.createElement("div");
    tarjeta.className = "tarjeta";

    const titulo = document.createElement("h3");
    titulo.textContent = proyecto.codigo;

    const detalle = document.createElement("p");
    detalle.textContent = proyecto.lugar;

    const boton = document.createElement("button");
    boton.textContent = "Abrir proyecto";
    boton.onclick = () => abrirProyecto(proyecto);

    tarjeta.append(titulo, detalle, boton);
    lista.append(tarjeta);
  }
}

function abrirProyecto(proyecto) {
  proyectoActivo = proyecto.id;

  for (const campo of ["codigo", "fecha", "lugar",
                         "fiscalizador", "establecimiento"]) {
    document.getElementById(campo).value = proyecto[campo];
  }

  document.getElementById("galeria").replaceChildren();
  document.getElementById("vistaAnexo").replaceChildren();
  mostrarMensaje("Proyecto abierto: " + proyecto.codigo);
}

document.getElementById("formProyecto").addEventListener(
  "submit", async (evento) => {
    evento.preventDefault();

    const datos = {};
    for (const campo of ["codigo", "fecha", "lugar",
                         "fiscalizador", "establecimiento"]) {
      datos[campo] = document.getElementById(campo).value.trim();
      if (!datos[campo]) {
        mostrarMensaje("Complete el campo: " + campo);
        return;
      }
    }

    datos.id = proyectoActivo || crypto.randomUUID();

    try {
      await guardarRegistro("proyectos", datos);
      proyectoActivo = datos.id;
      await listarProyectos();
      mostrarMensaje("Fiscalización guardada correctamente");
    } catch (error) {
      console.error(error);
      mostrarMensaje("Error al guardar la fiscalización");
    }
  }
);

listarProyectos().catch(console.error);

let archivosPendientes = [];

document.getElementById("btnCamara").addEventListener("click", () => {
  if (!proyectoActivo) {
    mostrarMensaje("Primero guarde o abra una fiscalización");
    return;
  }
  document.getElementById("inputCamara").click();
});

document.getElementById("btnAgregar").addEventListener("click", () => {
  if (!proyectoActivo) {
    mostrarMensaje("Primero guarde o abra una fiscalización");
    return;
  }
  document.getElementById("inputImagenes").click();
});

async function prepararImagenes(archivos) {
  const imagenes = Array.from(archivos).filter(
    archivo => archivo.type.startsWith("image/")
  );

  if (!imagenes.length) {
    mostrarMensaje("No se seleccionaron imágenes válidas");
    return;
  }

  archivosPendientes = imagenes;
  const contenedor = document.getElementById("vistaCaptura");
  contenedor.replaceChildren();

  const titulo = document.createElement("h3");
  titulo.textContent = "Vista previa antes de guardar";
  contenedor.append(titulo);

  for (const archivo of imagenes) {
    const imagen = document.createElement("img");
    const url = URL.createObjectURL(archivo);
    imagen.src = url;
    imagen.onload = () => URL.revokeObjectURL(url);
    imagen.alt = "Fotografía pendiente";
    contenedor.append(imagen);
  }

  const confirmar = document.createElement("button");
  confirmar.textContent = "Confirmar y guardar fotografías";
  confirmar.onclick = guardarFotografias;

  const cancelar = document.createElement("button");
  cancelar.textContent = "Cancelar";
  cancelar.onclick = () => {
    archivosPendientes = [];
    contenedor.replaceChildren();
    mostrarMensaje("Incorporación cancelada");
  };

  contenedor.append(confirmar, cancelar);
}

document.getElementById("inputCamara").addEventListener(
  "change", evento => {
    prepararImagenes(evento.target.files);
    evento.target.value = "";
  }
);

document.getElementById("inputImagenes").addEventListener(
  "change", evento => {
    prepararImagenes(evento.target.files);
    evento.target.value = "";
  }
);

async function guardarFotografias() {
  if (!proyectoActivo || !archivosPendientes.length) return;

  try {
    const existentes = (await obtenerRegistros("fotografias"))
      .filter(foto => foto.proyectoId === proyectoActivo);

    let orden = existentes.reduce(
      (maximo, foto) => Math.max(maximo, foto.orden), 0
    );

    for (const archivo of archivosPendientes) {
      orden++;

      await guardarRegistro("fotografias", {
        id: crypto.randomUUID(),
        proyectoId: proyectoActivo,
        imagen: archivo,
        descripcion: "",
        incorporadaEn: new Date().toISOString(),
        orden
      });
    }

    archivosPendientes = [];
    document.getElementById("vistaCaptura").replaceChildren();
    mostrarMensaje("Fotografías guardadas correctamente");
    await mostrarGaleria();
  } catch (error) {
    console.error(error);
    mostrarMensaje("Error al guardar las fotografías");
  }
}

async function mostrarGaleria() {
  const galeria = document.getElementById("galeria");
  galeria.replaceChildren();

  if (!proyectoActivo) return;

  const fotos = (await obtenerRegistros("fotografias"))
    .filter(foto => foto.proyectoId === proyectoActivo)
    .sort((a, b) => a.orden - b.orden);

  for (const [indice, foto] of fotos.entries()) {
    const tarjeta = document.createElement("div");
    tarjeta.className = "tarjeta";

    const titulo = document.createElement("h3");
    titulo.textContent = `Foto N.º ${String(indice + 1).padStart(2, "0")}`;

    const imagen = document.createElement("img");
    const url = URL.createObjectURL(foto.imagen);
    imagen.src = url;
    imagen.alt = titulo.textContent;
    imagen.onload = () => URL.revokeObjectURL(url);

    const etiqueta = document.createElement("label");
    etiqueta.textContent = "Descripción";

    const descripcion = document.createElement("textarea");
    descripcion.value = foto.descripcion;
    descripcion.placeholder = "Describa la fotografía";
    descripcion.addEventListener("change", async () => {
      foto.descripcion = descripcion.value.trim();
      try {
        await guardarRegistro("fotografias", foto);
        mostrarMensaje("Descripción guardada");
      } catch (error) {
        console.error(error);
        mostrarMensaje("Error al guardar descripción");
      }
    });

    tarjeta.append(titulo, imagen, etiqueta, descripcion);
    galeria.append(tarjeta);
  }
}

const abrirProyectoOriginal = abrirProyecto;
abrirProyecto = function(proyecto) {
  abrirProyectoOriginal(proyecto);
  mostrarGaleria().catch(console.error);
};

async function eliminarFotografia(id) {
  if (!confirm("¿Está seguro de eliminar esta fotografía?")) return;

  try {
    const db = await abrirBaseDatos();

    await new Promise((resolve, reject) => {
      const tx = db.transaction("fotografias", "readwrite");
      tx.objectStore("fotografias").delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });

    db.close();
    await mostrarGaleria();
    mostrarMensaje("Fotografía eliminada correctamente");
  } catch (error) {
    console.error(error);
    mostrarMensaje("Error al eliminar la fotografía");
  }
}

async function moverFotografia(id, direccion) {
  try {
    const fotos = (await obtenerRegistros("fotografias"))
      .filter(foto => foto.proyectoId === proyectoActivo)
      .sort((a, b) => a.orden - b.orden);

    const posicion = fotos.findIndex(foto => foto.id === id);
    const destino = posicion + direccion;

    if (destino < 0 || destino >= fotos.length) return;

    const actual = fotos[posicion];
    const otra = fotos[destino];

    const ordenAnterior = actual.orden;
    actual.orden = otra.orden;
    otra.orden = ordenAnterior;

    const db = await abrirBaseDatos();

    await new Promise((resolve, reject) => {
      const tx = db.transaction("fotografias", "readwrite");
      const almacen = tx.objectStore("fotografias");

      almacen.put(actual);
      almacen.put(otra);

      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });

    db.close();
    await mostrarGaleria();
    mostrarMensaje("Orden actualizado correctamente");
  } catch (error) {
    console.error(error);
    mostrarMensaje("Error al cambiar el orden");
  }
}

const mostrarGaleriaOriginal = mostrarGaleria;

mostrarGaleria = async function() {
  await mostrarGaleriaOriginal();

  const tarjetas = document.querySelectorAll("#galeria .tarjeta");

  const fotos = (await obtenerRegistros("fotografias"))
    .filter(foto => foto.proyectoId === proyectoActivo)
    .sort((a, b) => a.orden - b.orden);

  tarjetas.forEach((tarjeta, indice) => {
    const foto = fotos[indice];
    if (!foto) return;

    const subir = document.createElement("button");
    subir.textContent = "Subir";
    subir.disabled = indice === 0;
    subir.onclick = () => moverFotografia(foto.id, -1);

    const bajar = document.createElement("button");
    bajar.textContent = "Bajar";
    bajar.disabled = indice === fotos.length - 1;
    bajar.onclick = () => moverFotografia(foto.id, 1);

    const eliminar = document.createElement("button");
    eliminar.textContent = "Eliminar";
    eliminar.style.background = "#b91c1c";
    eliminar.onclick = () => eliminarFotografia(foto.id);

    tarjeta.append(subir, bajar, eliminar);
  });
};
/* Barra de herramientas para gestionar fotografías */

let fotoSeleccionadaId = null;

const barraFotos = document.createElement("div");
barraFotos.id = "barraFotos";

barraFotos.innerHTML = `
  <button type="button" id="subirSeleccionada">↑ Subir</button>
  <button type="button" id="bajarSeleccionada">↓ Bajar</button>
  <button type="button" id="eliminarSeleccionada">Eliminar</button>
  <span id="estadoSeleccion">Ninguna fotografía seleccionada</span>
`;

document.getElementById("galeria").before(barraFotos);

const galeriaAnterior = mostrarGaleria;

mostrarGaleria = async function() {
  await galeriaAnterior();

  const fotos = (await obtenerRegistros("fotografias"))
    .filter(f => f.proyectoId === proyectoActivo)
    .sort((a, b) => a.orden - b.orden);

  const tarjetas = document.querySelectorAll("#galeria .tarjeta");

  if (!fotos.some(f => f.id === fotoSeleccionadaId)) {
    fotoSeleccionadaId = null;
  }

  tarjetas.forEach((tarjeta, indice) => {
    const foto = fotos[indice];

    tarjeta.querySelectorAll("button").forEach(b => b.remove());

    tarjeta.style.cursor = "pointer";

    tarjeta.addEventListener("click", evento => {
      if (evento.target.closest("textarea")) return;

      fotoSeleccionadaId = foto.id;
      actualizarSeleccion();
    });
  });

  function actualizarSeleccion() {
    tarjetas.forEach((tarjeta, indice) => {
      tarjeta.classList.toggle(
        "foto-seleccionada",
        fotos[indice].id === fotoSeleccionadaId
      );
    });

    const indice = fotos.findIndex(f => f.id === fotoSeleccionadaId);

    document.getElementById("estadoSeleccion").textContent =
      indice >= 0
        ? `Foto N.º ${String(indice + 1).padStart(2, "0")} seleccionada`
        : "Ninguna fotografía seleccionada";

    document.getElementById("subirSeleccionada").disabled = indice <= 0;
    document.getElementById("bajarSeleccionada").disabled =
      indice < 0 || indice === fotos.length - 1;
    document.getElementById("eliminarSeleccionada").disabled = indice < 0;
  }

  actualizarSeleccion();
};

document.getElementById("subirSeleccionada").onclick = async () => {
  if (fotoSeleccionadaId) {
    await moverFotografia(fotoSeleccionadaId, -1);
  }
};

document.getElementById("bajarSeleccionada").onclick = async () => {
  if (fotoSeleccionadaId) {
    await moverFotografia(fotoSeleccionadaId, 1);
  }
};

document.getElementById("eliminarSeleccionada").onclick = async () => {
  if (fotoSeleccionadaId) {
    await eliminarFotografia(fotoSeleccionadaId);
  }
};

const abrirProyectoConSeleccion = abrirProyecto;

abrirProyecto = function(proyecto) {
  fotoSeleccionadaId = null;
  abrirProyectoConSeleccion(proyecto);
};

mostrarGaleria().catch(console.error);
