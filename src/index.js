import {
    Ion,
    Viewer,
    Camera,
    Rectangle,
    SceneMode,
    Transforms,
    Matrix4,
    Cartesian3,
    Color,
    Material,
    JulianDate,
    PolylineCollection,
    FrameRateMonitor,
} from 'cesium';

import "cesium/Build/Cesium/Widgets/widgets.css";
import "./css/main.css";

import 'bootstrap/dist/css/bootstrap.min.css';
// import { $ } from 'jquery';
import 'jquery/dist/jquery.min.js';
import 'popper.js/dist/umd/popper.min.js';
import 'bootstrap/dist/js/bootstrap.min.js';
require('./favicon.png');

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
});

//remove Bing imagery
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

//polylines
const polylines = new PolylineCollection(); //collection for displaying orbits
scene.primitives.add(polylines);

//change lighting parameters
globe.nightFadeInDistance = 40000000;
globe.nightFadeOutDistance = 10000000;

document.getElementById("buttons").style.visibility = "visible"; //makes buttons visible after loading javascript
let satUpdateIntervalTime = 33; //update interval in ms
const orbitSteps = 6; //number of steps in predicted orbit

const satellitesData = []; //currently displayed satellites TLE data (name, satrec)

//============================================================

// button1
document.getElementById("btn1").onclick = () => {
    console.log('btn1');
    calculateOrbit(sat);
}

// button2
document.getElementById("btn2").onclick = () => {
    console.log('btn2');
}

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

//TESTING
const tle0 = 'STARLINK-80';
const tle1 = '1 44282U 19029AZ  20318.68146104  .00009418  00000-0  36419-3 0  9993';
const tle2 = '2 44282  53.0238 202.3986 0003420   8.8438 351.2619 15.26909216 80818';
const sat = new Array(tle0, tle1, tle2);
satellitesData.push(new Array(tle0, satellite.twoline2satrec(tle1, tle2)));
//THE END OF TESTING SECTION

const addSatelliteMarker = ([satName, satrec]) => {
    const posvel = satellite.propagate(satrec, JulianDate.toDate(clock.currentTime));
    const gmst = satellite.gstime(JulianDate.toDate(clock.currentTime));
    const pos = Object.values(satellite.eciToEcf(posvel.position, gmst)).map(el => el *= 1000); //position km->m

    entities.add({
        name: satName,
        position: Cartesian3.fromArray(pos),
        point: {
            pixelSize: 10,
            color: Color.YELLOW,
        },
    });
}

//ORBIT CALCULATION (TEST)
const calculateOrbit = (tle) => {
    //init
    const satrec = satellite.twoline2satrec(tle[1], tle[2]);
    let orbitPoints = []; //array for calculated points
    const period = (2 * Math.PI) / satrec.no; // orbital period in minutes
    const timeStep = period / orbitSteps; //time interval between points on orbit
    let baseTime = new JulianDate(); //time of the first point
    JulianDate.addMinutes(clock.currentTime, -period / 2, baseTime); //sets base time to the half period ago
    let tempTime = new JulianDate(); //temp date for calculations

    //calculate points in ECI coordinate frame
    for (let i = 0; i < orbitSteps; i++) {
        JulianDate.addMinutes(baseTime, i * timeStep, tempTime);
        let posvelTemp = satellite.propagate(satrec, JulianDate.toDate(tempTime));
        orbitPoints.push(Cartesian3.fromArray(Object.values(posvelTemp.position)));
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
};

// addSatelliteMarker(sat);
addSatelliteMarker(satellitesData[0]);
// calculateOrbit(sat); //test

const updateSatellites = (satellites) => { //updates satellites positions
    if (satellites.length) {
        const gmst = satellite.gstime(JulianDate.toDate(clock.currentTime));
        satellites.forEach(([satName, satrec], index) => { //update satellite entity position
            const posvel = satellite.propagate(satrec, JulianDate.toDate(clock.currentTime));
            const pos = Object.values(satellite.eciToEcf(posvel.position, gmst)).map(el => el *= 1000); //position km->m

            entities.values[index].position = Cartesian3.fromArray(pos); //update satellite position
        });
    }
};

//update selected satellite orbit -> todo

const updateFPScounter = () => {
    let fps = frameRateMonitor.lastFramesPerSecond;
    if (fps) {
        document.getElementById('fps').innerText = fps.toFixed(0).toString();
    }
}

const satUpdateInterval = setInterval(updateSatellites, satUpdateIntervalTime, satellitesData); //enables satellites positions update
const frameRateMonitorInterval = setInterval(updateFPScounter, 500);
scene.postUpdate.addEventListener(cameraIcrf); //enables camera lock at the start
scene.postUpdate.addEventListener(orbitIcrf); //enables orbit lock at the start
viewer.camera.changed.addEventListener(() => { //enable camera lock after zoom
    if (scene.mode === SceneMode.SCENE3D) {
        if (viewer.camera.getMagnitude() < 8000000) {
            disableCamIcrf();
            sw2.checked = true;
            sw2.disabled = true;
        } else {
            sw2.disabled = false;
        }
    }
});