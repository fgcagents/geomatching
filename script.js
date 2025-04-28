let itineraryList = [];
  let idToTrainMap = new Map();
  let map;
  let markersLayer = L.layerGroup();

  const trainIcon = L.divIcon({
    html: `<div style="font-size: 24px;">🚆</div>`,
    className: 'train-marker',
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });

  // Inicializa el mapa con capas base y capas adicionales como OpenRailwayMap.
  // También configura un grupo de capas para los marcadores de trenes.
  function initMap() {
    if (!map) {
      map = L.map("map", {
      zoomControl: false
    }).setView([41.4, 2.1], 11);

      
      // Capa base de CARTO
      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution: '&copy; J_E_O &copy; OpenStreetMap &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 19
      }).addTo(map);

      // Capa de vías férreas de OpenRailwayMap 
      L.tileLayer('https://tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openrailwaymap.org/">OpenRailwayMap</a>',
        maxZoom: 19,
        opacity: 0.7
      }).addTo(map);

      markersLayer.addTo(map);
    }
  }

  // Descarga los datos de trenes desde una API en formato GeoJSON.
  // Convierte los datos en un formato más manejable para el resto del código.
  async function fetchAllTrains() {
    try {
        console.log('Iniciando fetchAllTrains...');
        const response = await fetch('https://geotren.fgc.cat/tracker/trens.geojson');
        
        if (!response.ok) {
            console.error('Error en la descarga del fitxer:', response.status);
            return [];
        }
        
        const data = await response.json();
        const trains = data.features.map(feature => ({
            ...feature.properties,
            coordinates: feature.geometry.coordinates
        }));
        
        console.log('Trenes descargados:', trains.length);
        console.log('Muestra de datos:', trains[0]);
        
        return trains;
    } catch (error) {
        console.error('Error al descargar el fitxer:', error);
        return [];
    }
  }

  // Convierte una hora en formato "HH:mm" a un objeto Date para facilitar cálculos.
  function parseHora(horaStr) {
    const [h, m] = horaStr.split(":").map(Number);
    return new Date(0, 0, 0, h, m);
  }

  function getHoraActual() {
    const now = new Date();
    return new Date(0, 0, 0, now.getHours(), now.getMinutes());
  }

  // Obtiene la hora actual como un objeto Date con solo horas y minutos.
  function parseProperesParades(properes) {
    try {
        // Si ya es un array (como en el JSON), simplemente mapeamos los valores
        if (Array.isArray(properes)) {
            return properes.map(p => p.parada);
        }
        // Por compatibilidad, mantenemos el parseo de string si viene en el formato antiguo
        const parades = "[" + properes + "]";
        return JSON.parse(parades.replace(/;/g, ",")).map(p => p.parada);
    } catch (error) {
        console.error('Error parseando paradas:', error);
        return [];
    }
}

// Convierte una hora en formato "HH:mm" a minutos totales desde la medianoche.
const timeToMinutes = timeStr => {
  if (!timeStr) return null;
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
};

// Ordena resultados basados en la hora, ajustando para horas cercanas a medianoche.
const sortResultsByTime = results => {
  return results.sort((a, b) => {
      const timeA = timeToMinutes(a.hora);
      const timeB = timeToMinutes(b.hora);
      if (timeA === null) return 1;
      if (timeB === null) return -1;
      const adjustedTimeA = timeA < 240 ? timeA + 1440 : timeA;
      const adjustedTimeB = timeB < 240 ? timeB + 1440 : timeB;
      return adjustedTimeA - adjustedTimeB;
  });
};

// Obtiene el itinerario de un tren ordenado por hora.
function getOrderedItinerary(train) {
  const parades = [];

  // Primera pasada para recoger todas las paradas
  for (const [key, value] of Object.entries(train)) {
      if (!["A/D", "Linia", "Tren"].includes(key) && value) {
          parades.push({
              estacio: key,
              hora: value
          });
      }
  }

  // Ordenar las paradas usando sortResultsByTime
  return sortResultsByTime(parades);
  
}

/**
 * Realiza el proceso de matching entre los trenes obtenidos de la API y los itinerarios cargados.
 * 
 * Parámetros:
 * - itineraryList: Array de itinerarios cargados (cada itinerario corresponde a un tren y contiene sus paradas y horarios).
 * - apiTrains: Array de trenes obtenidos de la API (con propiedades y coordenadas).
 * - horaActual: Objeto Date que representa la hora actual (solo se consideran horas y minutos).
 *
 * Funcionalidad:
 * 1. Inicializa un arreglo "matches" para guardar los coincidencias y un Set "matchedTrains" para llevar registro de trenes ya emparejados.
 * 2. Define un arreglo "liniesRequerides" con las líneas de tren que se desean procesar.
 * 
 * 3. Itera sobre cada objeto "api" en apiTrains:
 *    a. Extrae el ID de la API, la línea (se utiliza substring para obtener los dos primeros caracteres) y la dirección.
 *    b. Parsea la lista de próximas paradas usando "parseProperesParades".
 *    c. Define "estacioActual" como la primera parada, ya sea proveniente del campo "estacionat_a" o de properes.
 *    d. Si la línea del tren no está en "liniesRequerides", se continúa al siguiente tren.
 * 
 * 4. Verifica si el tren ya existe en "idToTrainMap":
 *    a. Si existe, actualiza la próxima parada, coordenadas y el tipo de unidad.
 *    b. Busca en la lista de itinerarios el tren que coincide y, de existir, obtiene el itinerario ordenado.
 *    c. Recorre las paradas del itinerario para ver si coincide en tiempo (dentro de 10 minutos) y en secuencia con la parada actual.
 *       - Si se cumple, se marca con "coincideEnTiempoYSecuencia" y se agrega la coincidencia a "matches" y se registra en "matchedTrains".
 *    d. Si no se cumple la condición de coincidencia, elimina el tren de "idToTrainMap".
 * 
 * 5. En caso de que el tren no se haya emparejado (o no exista en idToTrainMap):
 *    a. Se busca el mejor matching iterando sobre cada itinerario (filtrando por línea y dirección).
 *    b. Para cada itinerario, se calcula la diferencia en minutos entre la hora del itinerario y la hora actual.
 *    c. Si la diferencia es de 10 minutos o menos y la parada actual coincide o se encuentra en la lista de properes,
 *       se asigna una puntuación basada en la proximidad en tiempo y si coincide la secuencia de paradas.
 *    d. Se guarda el mejor match (el que obtenga la mayor puntuación).
 * 
 * 6. Si se encontró un mejor match:
 *    a. Se agrega al arreglo "matches", se registra en "matchedTrains" y se actualiza "idToTrainMap" con la información del tren y su estado.
 *       Se incluye también el campo "en_hora" para determinar si va en tiempo.
 * 
 * 7. Finalmente, se retorna el arreglo "matches" que contiene todos los emparejamientos encontrados.
 */
function matchTrains(itineraryList, apiTrains, horaActual) {
    const matches = [];
    const matchedTrains = new Set();
    const liniesRequerides = ["R5", "R6", "S3", "S4", "S8", "S9", "L8"];

    // Recorre cada tren obtenido de la API
    for (const api of apiTrains) {
        const apiId = api.id;
        const liniaApi = api.lin.substring(0, 2);
        const direccio = api.dir;
        const properes = parseProperesParades(api.properes_parades);
        const estacioActual = api.estacionat_a || (properes.length > 0 ? properes[0] : "");

        // Se omiten trenes que no pertenecen a las líneas requeridas
        if (!liniesRequerides.includes(liniaApi)) {
            continue;
        }

        // Si el tren ya está en idToTrainMap, se intenta actualizar su información
        if (idToTrainMap.has(apiId)) {
            const trainData = idToTrainMap.get(apiId);
            trainData.proximaParada = properes.length > 0 ? properes[0] : null;
            trainData.coordinates = api.coordinates;
            trainData.tipus_unitat = api.tipus_unitat || 'Desconegut'; // Se asegura que el campo de tipo de unidad esté definido
            const trenNom = trainData.tren;
            const train = itineraryList.find(t => t.Tren === trenNom);
            if (!train || matchedTrains.has(trenNom)) continue;

            const itinerarioOrdenado = getOrderedItinerary(train);
            let coincideEnTiempoYSecuencia = false;

            // Recorre el itinerario para determinar si hay coincidencia en tiempo y secuencia
            for (const parada of itinerarioOrdenado) {
                const { estacio, hora } = parada;
                const horaEst = parseHora(hora);
                const diffMin = Math.abs((horaEst - horaActual) / 60000);

                // Verifica si la diferencia es de 10 minutos o menos y si la parada coincide o se encuentra en las próximas paradas
                if (diffMin <= 10 && (estacio === estacioActual || properes.includes(estacio))) {
                    // Se corrobora la secuencia de paradas: si coincide o si se cumple la secuencia esperada
                    if (estacio === estacioActual || verificarSecuenciaParadas(properes, itinerarioOrdenado, estacio)) {
                        coincideEnTiempoYSecuencia = true;
                        matches.push({
                            tren: trenNom,
                            linia: liniaApi,
                            direccio,
                            estacio: estacioActual,
                            hora: hora,
                            matched: true
                        });
                        matchedTrains.add(trenNom);
                        break;
                    }
                }
            }

            // Si no se cumple la coincidencia, se elimina el tren de idToTrainMap
            if (!coincideEnTiempoYSecuencia) {
                idToTrainMap.delete(apiId);
            } else {
                continue;
            }
        }

        // Si el tren no ha sido emparejado previamente, se busca el mejor matching del itinerario
        let mejorMatch = null;
        let mejorPuntuacion = 0;
        let horaMatch = "";

        // Se recorre cada itinerario disponible
        for (const train of itineraryList) {
            const liniaItinerary = train.Linia.substring(0, 2);
            // Se descartan itinerarios que no correspondan a la línea y dirección requeridas
            if (liniaItinerary !== liniaApi || train["A/D"] !== direccio) continue;
            if (matchedTrains.has(train.Tren)) continue;

            const itinerarioOrdenado = getOrderedItinerary(train);

            // Se evalúa cada parada para asignar una puntuación basada en la cercanía de tiempo y coincidencia de paradas
            for (let i = 0; i < itinerarioOrdenado.length; i++) {
                const { estacio, hora } = itinerarioOrdenado[i];
                const horaEst = parseHora(hora);
                const diffMin = Math.abs((horaEst - horaActual) / 60000);

                if (diffMin <= 10 && (estacio === estacioActual || properes.includes(estacio))) {
                    let puntuacion = 10 - diffMin;

                    if (estacio === estacioActual) {
                        puntuacion += 5;
                    }

                    if (verificarSecuenciaParadas(properes, itinerarioOrdenado, estacio)) {
                        puntuacion += 10;
                    }

                    // Se guarda el itinerario con mayor puntuación
                    if (puntuacion > mejorPuntuacion) {
                        mejorMatch = {
                            tren: train.Tren,
                            linia: liniaItinerary,
                            direccio,
                            estacio: estacioActual,
                            hora: hora,
                            matched: true
                        };
                        mejorPuntuacion = puntuacion;
                        horaMatch = hora;
                    }
                }
            }
        }

        // Si se encontró un mejor match, se agrega al arreglo de coincidencias y se actualiza la información en idToTrainMap
        if (mejorMatch) {
            matches.push(mejorMatch);
            matchedTrains.add(mejorMatch.tren);
            idToTrainMap.set(apiId, {
                tren: mejorMatch.tren,
                coordinates: api.coordinates,
                proximaParada: properes.length > 0 ? properes[0] : null,
                en_hora: api.en_hora  // Se añade indicador de que el tren va a tiempo
            });
        }
    }

    // Retorna el conjunto de coincidencias encontradas entre la API y los itinerarios
    return matches;
}

  // Verifica si las próximas paradas de un tren coinciden con el itinerario esperado.
  function verificarSecuenciaParadas(properes, itinerario, estacioActual) {
    if (properes.length === 0 || itinerario.length === 0) return false;
    
    const indexActual = itinerario.findIndex(p => p.estacio === estacioActual);
    if (indexActual === -1) return false;
    
    let coincidencias = 0;
    let minCoincidenciasRequeridas = Math.min(2, properes.length);
    
    for (let i = 0; i < properes.length; i++) {
      const indexItinerario = indexActual + i + 1;
      if (indexItinerario >= itinerario.length) break;
      
      if (properes[i] === itinerario[indexItinerario].estacio) {
        coincidencias++;
        if (coincidencias >= minCoincidenciasRequeridas) return true;
      } else {
        break;
      }
    }
    
    return false;
  }

  // Actualiza los marcadores en el mapa con la información de los trenes activos.
  // Incluye detalles como retrasos, próximas paradas y tipo de unidad.
  function updateMapMarkers() {
    markersLayer.clearLayers();
    let count = 0;
    
    idToTrainMap.forEach((trainData, id) => {
        const [lng, lat] = trainData.coordinates;
        if (lat && lng) {
            const trainInfo = itineraryList.find(t => t.Tren === trainData.tren);
            const flecha = trainInfo && trainInfo['A/D'] === "A" ? "🔼" : "🔽";
            
            // Obtener la hora de paso si existe la próxima parada
            let horaPaso = '';
            if (trainData.proximaParada && trainInfo) {
                horaPaso = trainInfo[trainData.proximaParada] || '';
            }

            let retardHTML = '';
            if (horaPaso) {
              const [h, m] = horaPaso.split(':').map(Number);
              const horaPrevista = new Date();
              horaPrevista.setHours(h, m, 0, 0);
              const ara = new Date();

              const diffMs = ara - horaPrevista;
              const diffMin = Math.round(diffMs / 60000);

              if (!isNaN(diffMin)) {
                if (diffMin > 0) {
                  retardHTML = `<br><span class="label">Retard:</span> <span class="value" style="color:red;">+${diffMin} min</span>`;
                } else {
                  retardHTML = `<br><span class="label">A temps</span>`;
                }
              }
            }

            const proximaParada = trainData.proximaParada ? 
                `<div class="info-row">
                    <span class="label">Propera parada:</span> 
                    <span class="value">${trainData.proximaParada}</span>
                    ${horaPaso ? `<br><span class="label">Hora:</span> 
                    <span class="value">${horaPaso}</span>` : ''}
                    ${retardHTML}
                </div>` : '';

            // Añadir el campo tipus_unitat al popup
            const tipusUnitat = trainData.tipus_unitat || 'Desconegut';
    
            const marker = L.marker([lat, lng], {
                icon: trainIcon
            }).bindTooltip(`${flecha} ${trainData.tren} Línea: ${trainData.lin || 'Desconeguda'}`, {
                permanent: true,
                direction: 'top',
                offset: [4, -15],
                /*className: trainData.en_hora === true ? 'leaflet-tooltip tooltip-verde' : 'leaflet-tooltip tooltip-vermell'*/
                className: (trainData.en_hora === true || (retardHTML.includes('+') && parseInt(retardHTML.match(/\+(\d+)/)?.[1]) <= 2)) 
                    ? 'leaflet-tooltip tooltip-verde' 
                    : 'leaflet-tooltip tooltip-vermell'
              }
            ).bindPopup(trainInfo ? `
                <div class="custom-popup">
                    <h3>🚆 <a href="#" onclick="showItinerary('${trainData.tren}'); return false;">Tren ${trainData.tren}</a></h3>
                    <div class="info-row">
                        <span class="label">Línea:</span>
                        <span class="value">${trainInfo ? trainInfo.Linia : 'N/A'}</span>
                    </div>
                    ${proximaParada}
                    <div class="info-row">
                        <span class="label">Tipus Unitat:</span>
                        <span class="value">${tipusUnitat}</span>
                    </div>
                </div>
            ` : `
            <div class="custom-popup">
                <h3>🚆 Tren sense matching</h3>
                <div class="info-row">
                    <span class="label">Línea:</span>
                    <span class="value">${trainData.lin || 'Desconeguda'}</span>
                </div>
            </div>
        `, {
                offset: L.point(4, 0)  // Desplaza el popup 20 píxeles hacia arriba
            });
            
            markersLayer.addLayer(marker);
            count++;
        }
    });
    
    document.getElementById("matchedCount").textContent = count;
  }

  // Reinicia los datos cargados, eliminando itinerarios y marcadores del mapa.
  function resetData() {
    itineraryList = [];
    idToTrainMap.clear();
    markersLayer.clearLayers();
    document.getElementById("matchedCount").textContent = "0";
  }

  // Refresca los datos del mapa descargando los trenes activos y actualizando los marcadores.
  // También elimina trenes que ya no están activos.
  async function refresh() {
    if (itineraryList.length === 0) {
        console.log("No hay itinerarios cargados");
        alert("Primero carga un archivo JSON con itinerarios");
        return;
    }


    try {
        const horaActual = getHoraActual();
        const apiTrains = await fetchAllTrains();
        console.log("Trenes obtenidos de la API:", apiTrains.length);
        console.log("Estado actual de idToTrainMap:", idToTrainMap.size);


        // Limpiar trenes no activos
        const idsActuals = new Set(apiTrains.map(api => api.id));
        console.log("IDs de trenes activos:", Array.from(idsActuals));


        Array.from(idToTrainMap.keys()).forEach(id => {
            if (!idsActuals.has(id)) {
                console.log(`Eliminando tren inactivo con ID: ${id}`);
                idToTrainMap.delete(id);
            }
        });


        const matches = matchTrains(itineraryList, apiTrains, horaActual);
        console.log("Matches encontrados:", matches.length);
        console.log("Estado final de idToTrainMap:", idToTrainMap.size);
        console.log("Contenido de idToTrainMap:", Array.from(idToTrainMap.entries()));


        updateMapMarkers();
    } catch (error) {
        console.error('Error en refresh:', error);
    }
  }


  document.querySelectorAll('.controls__file-button').forEach(button => {
  button.addEventListener('click', async function() {
    const fileName = this.dataset.file;
    
    try {
      // Desactivar todos los botones
      document.querySelectorAll('.controls__file-button').forEach(btn => {
        btn.classList.remove('active');
      });
      
      // Activar el botón seleccionado
      this.classList.add('active');
      
      // Reiniciar los datos antes de cargar el nuevo archivo
      resetData();
      
      const response = await fetch(fileName);
      if (!response.ok) {
        throw new Error(`Error al cargar el archivo: ${fileName}`);
      };
      
      const data = await response.json();
      itineraryList = data;
      alert(`Itinerario ${fileName} cargado correctamente.`);
      refresh();
    } catch (error) {
      alert(`Error al cargar el archivo ${fileName}: ${error.message}`);
      this.classList.remove('active');
    }
  });
});


  
function showItinerary(trainName) {
  const tren = itineraryList.find(t => t.Tren === trainName);
  if (!tren) return;


  document.getElementById("modalTrainName").textContent = trainName;


  const tableBody = document.getElementById("itineraryTable").querySelector("tbody");
  tableBody.innerHTML = "";


  // Utilizamos getOrderedItinerary para obtener las paradas ordenadas correctamente
  const itinerarioOrdenado = getOrderedItinerary(tren);
  
  // Añadimos cada parada a la tabla
  for (const parada of itinerarioOrdenado) {
    const row = `<tr><td>${parada.estacio}</td><td>${parada.hora}</td></tr>`;
    tableBody.innerHTML += row;
  }


  document.getElementById("itineraryModal").style.display = "block";
}


  // Inicializar el mapa al cargar
  initMap();
  setInterval(refresh, 10000);