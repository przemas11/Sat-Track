import {
    Ion,
    Viewer,
    Camera,
    Rectangle,
    SceneMode,
    Transforms,
    Matrix4,
    Cartesian2,
    Cartesian3,
    HorizontalOrigin,
    VerticalOrigin,
    Color,
    Material,
    JulianDate,
    PolylineCollection,
    FrameRateMonitor,
    ScreenSpaceEventHandler,
    ScreenSpaceEventType,
    defaultValue,
    Entity,
} from 'cesium';

import "cesium/Build/Cesium/Widgets/widgets.css";
import "./css/main.css";

import 'bootstrap/dist/css/bootstrap.min.css';
// import { $ } from 'jquery';
import 'jquery/dist/jquery.min.js';
import 'popper.js/dist/umd/popper.min.js';
import 'bootstrap/dist/js/bootstrap.min.js';

const satellite = require('satellite.js');

//INIT
Ion.defaultAccessToken = process.env.ACCESS_TOKEN; //token needed only to access Bing imagery
Camera.DEFAULT_VIEW_RECTANGLE = Rectangle.fromDegrees(-60, -40, 60, 80); //sets default view

const viewer = new Viewer('cesiumContainer', { //create viewer
    geocoder: false, //disables search bar
    infoBox: false,
    navigationInstructionsInitiallyVisible: false, //disables instructions on start
    sceneModePicker: false, //disables scene mode picker
    shouldAnimate: true,
    selectionIndicator: false,
});

//REMOVE BING IMAGERY
const viewModel = viewer.baseLayerPicker.viewModel;
viewModel.imageryProviderViewModels = viewModel.imageryProviderViewModels.filter((el) => {
    return el.category !== "Cesium ion";
});
viewModel.selectedImagery = viewModel.imageryProviderViewModels[0]; //select default imageryProvider

const scene = viewer.scene;
const globe = viewer.scene.globe;
const clock = viewer.clock;
const entities = viewer.entities;
const frameRateMonitor = new FrameRateMonitor({ scene: viewer.scene, quietPeriod: 0 });
viewer.homeButton.viewModel.duration = 1;
let dataLoadingInProgress = false;
let dataLoadingProgress = 0;

//POLYLINES
const polylines = new PolylineCollection(); //collection for displaying orbits
scene.primitives.add(polylines);

//change lighting parameters
globe.nightFadeInDistance = 40000000;
globe.nightFadeOutDistance = 10000000;

document.getElementById("ui").style.visibility = "visible"; //makes options visible after loading javascript
let satUpdateIntervalTime = 33; //update interval in ms
const orbitSteps = 44; //number of steps in predicted orbit

let satellitesData = []; //currently displayed satellites TLE data (name, satrec)
let displayedOrbit = undefined; //displayed orbit data [satrec, refresh time in seconds]
let lastOrbitUpdateTime = JulianDate.now();

//IMPORT DATA FROM JSON FILES
import TLEsources from './TLEsources.json'; //TLE satellites data sources
import translations from './translations.json'; //translations data

//SET UI STRINGS DEPENDING ON BROWSER LANGUAGE
const userLang = navigator.language.slice(0, 2) || navigator.userLanguage.slice(0, 2);
if (userLang !== undefined) {
    let translation = translations.find(tr => { return tr.language === userLang });
    if (translation !== undefined) {
        translation.strings.forEach((str) => {
            document.getElementById(str.id).innerHTML = str.text;
        });
    }
}

//ADD SOURCES BUTTONS
const btnsEntryPoint = document.getElementById('buttons-entry-point');
TLEsources.forEach((src) => {
    let labelLang = 'label-en';
    if (src[`label-${userLang}`] !== undefined) {
        labelLang = `label-${userLang}`;
    }
    const btnHTML = `<button class="cesium-button" type="button" name="enable-satellites">${src[labelLang]}</button>`;
    btnsEntryPoint.insertAdjacentHTML('beforeend', btnHTML);
});

//===============================================================
//USER INTERFACE ACTIONS
//menu button
document.getElementById("menu-button").onclick = () => {
    let o = document.getElementById("options");
    o.style.display === "block" ? o.style.display = "none" : o.style.display = "block";
}
// disable satellites button
document.getElementById("tr-disable-satellites").onclick = () => {
    deleteSatellites();
}
// any enable satellites button
document.getElementsByName("enable-satellites").forEach((el, i) => el.onclick = () => {
    deleteSatellites();
    getData(TLEsources[i].url);
});

//switch1
const sw1 = document.getElementById("sw1");
document.getElementById("sw1").onclick = () => {
    if (sw1.checked) {
        globe.enableLighting = true;
    } else {
        globe.enableLighting = false;
    }
}
//switch2
const sw2 = document.getElementById("sw2");
sw2.onclick = () => {
    if (sw2.checked) {
        disableCamIcrf();
    } else {
        enableCamIcrf();
    }
}

//deletes all satellites
const deleteSatellites = () => {
    satellitesData = [];
    displayedOrbit = undefined;
    polylines.removeAll();
    entities.removeAll();
}

//camera lock functions
const disableCamIcrf = () => { //locks camera on the globe
    scene.postUpdate.removeEventListener(cameraIcrf);
    viewer.camera.lookAtTransform(Matrix4.IDENTITY);
}
const enableCamIcrf = () => { //locks camera in space
    scene.postUpdate.addEventListener(cameraIcrf);
}
const cameraIcrf = (scene, time) => {
    if (scene.mode !== SceneMode.SCENE3D) {
        return;
    }
    let icrfToFixed = Transforms.computeIcrfToFixedMatrix(time);
    if (icrfToFixed !== undefined) {
        let camera = viewer.camera;
        let offset = Cartesian3.clone(viewer.camera.position);
        let transform = Matrix4.fromRotationTranslation(icrfToFixed);
        camera.lookAtTransform(transform, offset);
    }
}
//lock orbit in space
const orbitIcrf = (scene, time) => {
    if (polylines.length) {
        let mat = Transforms.computeTemeToPseudoFixedMatrix(time);
        polylines.modelMatrix = Matrix4.fromRotationTranslation(mat);
    }
}

const addSatelliteMarker = ([satName, satrec]) => {
    const posvel = satellite.propagate(satrec, JulianDate.toDate(clock.currentTime));
    const gmst = satellite.gstime(JulianDate.toDate(clock.currentTime));
    const pos = Object.values(satellite.eciToEcf(posvel.position, gmst)).map(el => el *= 1000); //position km->m

    entities.add({
        name: satName,
        position: Cartesian3.fromArray(pos),
        point: {
            pixelSize: 8,
            color: Color.YELLOW,
        },
        label: {
            show: false,
            text: satName,
            showBackground: true,
            font: "16px monospace",
            horizontalOrigin: HorizontalOrigin.LEFT,
            verticalOrigin: VerticalOrigin.CENTER,
            pixelOffset: new Cartesian2(10, 0),
            eyeOffset: Cartesian3.fromElements(0, 0, -10000),
        },
    });
}

//ORBIT CALCULATION
const calculateOrbit = (satrec) => {
    try {
        //init
        let orbitPoints = []; //array for calculated points
        const period = (2 * Math.PI) / satrec.no; // orbital period in minutes
        const timeStep = period / orbitSteps; //time interval between points on orbit
        let baseTime = new JulianDate(); //time of the first point
        JulianDate.addMinutes(clock.currentTime, -period / 2, baseTime); //sets base time to the half period ago
        let tempTime = new JulianDate(); //temp date for calculations

        //calculate points in ECI coordinate frame
        for (let i = 0; i <= orbitSteps; i++) {
            JulianDate.addMinutes(baseTime, i * timeStep, tempTime);
            let posvelTemp = satellite.propagate(satrec, JulianDate.toDate(tempTime));
            if (posvelTemp.position !== undefined) {
                orbitPoints.push(Cartesian3.fromArray(Object.values(posvelTemp.position)));
            }
        }

        //convert coordinates from kilometers to meters
        orbitPoints.forEach((point) => Cartesian3.multiplyByScalar(point, 1000, point));

        //polyline material
        const polylineMaterial = new Material.fromType('Color'); //create polyline material
        polylineMaterial.uniforms.color = Color.YELLOW; //set the material color

        polylines.removeAll();
        polylines.add({
            positions: orbitPoints,
            width: 1,
            material: polylineMaterial,
            id: 'orbit'
        });

        displayedOrbit = [satrec, period * 30];
    } catch (error) {
        console.log('This satellite is deorbited.');
    }

};

const clearOrbit = () => {
    displayedOrbit = undefined;
    polylines.removeAll();
}

const updateOrbit = () => {
    if (displayedOrbit !== undefined) {
        if (clock.currentTime.equalsEpsilon(lastOrbitUpdateTime, displayedOrbit[1]) === false) {
            lastOrbitUpdateTime = clock.currentTime;
            calculateOrbit(displayedOrbit[0]);
        }
    }
}

const updateSatellites = () => { //updates satellites positions
    if (satellitesData.length && viewer.clockViewModel.shouldAnimate) {
        const gmst = satellite.gstime(JulianDate.toDate(clock.currentTime));
        satellitesData.forEach(([satName, satrec], index) => { //update satellite entity position
            try {
                const posvel = satellite.propagate(satrec, JulianDate.toDate(clock.currentTime));
                const pos = Object.values(satellite.eciToEcf(posvel.position, gmst)).map(el => el *= 1000); //position km->m

                entities.values[index].position = Cartesian3.fromArray(pos); //update satellite position
                entities.values[index].point.color = Color.YELLOW; //update point color
            } catch (error) {
                entities.values[index].point.color = Color.RED; //update point color
            }
        });
    }
};

const setLoadingData = (bool) => { //shows loading bar
    dataLoadingInProgress = bool;
    // const loadingBar = document.getElementById("progress-bar");
    // if (bool) {
    //     loadingBar.style.visibility = "visible";
    // } else {
    //     loadingBar.style.visibility = "hidden";
    // }
}

const getData = async (targetUrl) => { //get TLE data using CORS proxy
    if (dataLoadingInProgress === false) {
        setLoadingData(true);
        const bar = document.getElementById("bar");

        const proxyUrl = 'https://cors-noproblem.herokuapp.com/';
        const response = await fetch(proxyUrl + targetUrl);
        let textLines = (await response.text()).split(/\r?\n/); //split file to separate lines
        textLines = textLines.filter(e => { return e }); //delete empty lines at the eof

        if (textLines.length) {
            let tempSatellitesData = [];
            //read file line by line
            try {
                for (let i = 0; i < textLines.length; i += 3) {
                    //check if TLE texts length is correct
                    if (textLines[i].length === 24 && textLines[i + 1].length === 69 && textLines[i + 2].length === 69) {
                        let tempSatrec = satellite.twoline2satrec(textLines[i + 1], textLines[i + 2]);

                        //check if TLE is valid
                        if (satellite.propagate(tempSatrec, JulianDate.toDate(clock.currentTime)).position === undefined) {
                            continue; //skips this loop iteration
                        }
                        tempSatellitesData.push([textLines[i].trim(), tempSatrec]);
                    } else {
                        throw `Error: The TLE data file can't be processed. The file may be corrupted.`
                    }
                }
            } catch (error) {
                console.log(error);
                setLoadingData(false);
            }
            tempSatellitesData.forEach(sat => addSatelliteMarker(sat)); //create point entities
            satellitesData.push(...tempSatellitesData); //add satellites to updated satellites array
        }
        setLoadingData(false);
    }
}

const updateFPScounter = () => {
    let fps = frameRateMonitor.lastFramesPerSecond;
    if (fps) {
        document.getElementById('fps').innerText = fps.toFixed(0).toString();
    }
}

const checkCameraZoom = () => { //changes state of camera lock switch depending on camera zoom
    setTimeout(() => {
        if (scene.mode === SceneMode.SCENE3D) {
            if (viewer.camera.getMagnitude() < 13000000) {
                disableCamIcrf();
                sw2.checked = true;
                sw2.disabled = true;
            } else {
                sw2.disabled = false;
            }
        }
    }, 10);
}

const satUpdateInterval = setInterval(updateSatellites, satUpdateIntervalTime); //enables satellites positions update
const frameRateMonitorInterval = setInterval(updateFPScounter, 500);
scene.postUpdate.addEventListener(cameraIcrf); //enables camera lock at the start
scene.postUpdate.addEventListener(orbitIcrf); //enables orbit lock at the start
scene.postUpdate.addEventListener(updateOrbit); //enables orbit update
// viewer.camera.changed.addEventListener(checkCameraZoom);

//USER INPUT HANDLERS
viewer.screenSpaceEventHandler.setInputAction((input) => { }, ScreenSpaceEventType.LEFT_DOUBLE_CLICK); //reset default doubleclick handler

const handler = new ScreenSpaceEventHandler(scene.canvas); //custom event handler
handler.setInputAction((input) => { //left click input action
    let picked = scene.pick(input.position);
    if (picked) {
        let entity = defaultValue(picked.id, picked.primitive.id);
        if (entity instanceof Entity) {
            if (entity.label.show.getValue() === false) {
                entity.label.show = true;
                calculateOrbit(satellitesData.find(el => el[0] === entity.name)[1]);
            } else {
                entity.label.show = false;
                clearOrbit();
            }
        }
    }
}, ScreenSpaceEventType.LEFT_CLICK);

handler.setInputAction((input) => { //mouse scroll
    checkCameraZoom();
}, ScreenSpaceEventType.WHEEL);