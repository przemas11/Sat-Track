import {
    Ion,
    Viewer,
    Camera,
    Rectangle,
    SceneMode,
    Transforms,
    Matrix3,
    Matrix4,
    Cartesian3,
    Color,
    Material,
    JulianDate,
    PolylineCollection,
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
    navigationInstructionsInitiallyVisible: false, //disables instructions on start
    shouldAnimate: true,
});

const viewModel = viewer.baseLayerPicker.viewModel; //remove Bing imagery
viewModel.imageryProviderViewModels = viewModel.imageryProviderViewModels.filter((el) => {
    return el.category !== "Cesium ion";
});
viewModel.selectedImagery = viewModel.imageryProviderViewModels[0]; //select default imageryProvider

const scene = viewer.scene;
const globe = viewer.scene.globe;

//polylines
const polylines = new PolylineCollection(); //collection for displaying orbits
viewer.scene.primitives.add(polylines);

//change lighting parameters
globe.nightFadeInDistance = 20000000;
globe.nightFadeOutDistance = 10000000;
document.getElementById("buttons").style.visibility = "visible";
const points = viewer.entities.values; //satellites marker points array
let satUpdateIntervalTime = 33; //update interval in ms

//============================================================

// button1
document.getElementById("btn1").onclick = () => {
    console.log('btn1');
    calculateOrbit();
}

// button2
document.getElementById("btn2").onclick = () => {
    console.log('btn2');
}

//switch1
const sw1 = document.getElementById("sw1");
document.getElementById("sw1").onclick = () => {
    if (sw1.checked) {
        viewer.scene.globe.enableLighting = true;
    } else {
        viewer.scene.globe.enableLighting = false;
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
    viewer.scene.postUpdate.removeEventListener(cameraIcrf);
    viewer.camera.lookAtTransform(Matrix4.IDENTITY);
}
const enableCamIcrf = () => { //locks camera in space
    viewer.scene.postUpdate.addEventListener(cameraIcrf);
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
const orbitIcrf = () => {
    let currentTime = viewer.clock.currentTime;
    if (polylines.length) {
        let mat = Transforms.computeTemeToPseudoFixedMatrix(currentTime);
        polylines.modelMatrix = Matrix4.fromRotationTranslation(mat);

        console.log('tick');
    }
}

//TESTING
var tle0 = 'STARLINK-80';
var tle1 = '1 44282U 19029AZ  20318.68146104  .00009418  00000-0  36419-3 0  9993';
var tle2 = '2 44282  53.0238 202.3986 0003420   8.8438 351.2619 15.26909216 80818';
// var tle0 = 'ISS (ZARYA)';
// var tle1 = '1 25544U 98067A   20320.04640396 -.00008984  00000-0 -15498-3 0  9990';
// var tle2 = '2 25544  51.6454 321.9942 0001595  43.4454  61.6326 15.49025312255403';

var satrec = satellite.twoline2satrec(tle1, tle2);

var posvel = satellite.propagate(satrec, JulianDate.toDate(viewer.clock.currentTime));
var gmst = satellite.gstime(JulianDate.toDate(viewer.clock.currentTime));
var geodeticCoords = satellite.eciToGeodetic(posvel.position, gmst);

viewer.entities.add({
    name: tle0,
    position: Cartesian3.fromRadians(geodeticCoords.longitude, geodeticCoords.latitude, geodeticCoords.height * 1000),
    point: {
        pixelSize: 10,
        color: Color.YELLOW,
    },
});

//ORBIT CALCULATION (TEST)
const calculateOrbit = () => {
    //init
    let currentTime = viewer.clock.currentTime; //sets current time
    let orbitPoints = []; //array for calculated points
    let period = (2 * Math.PI) / satrec.no; // orbital period in minutes
    let steps = 100; //number of steps/points
    let timeStep = period / steps; //time interval between points on orbit
    let baseTime = new JulianDate(); //time of the first point
    JulianDate.addMinutes(currentTime, -period / 2, baseTime); //sets base time to the half period ago
    let tempTime = new JulianDate(); //temp date for calculations
    let gmstTemp = satellite.gstime(JulianDate.toDate(currentTime)); //gstime for ECI->ECF conversion

    //calculate points in ECI coordinate frame
    for (let i = 0; i < steps; i++) {
        JulianDate.addMinutes(baseTime, i * timeStep, tempTime);
        let posvelTemp = satellite.propagate(satrec, JulianDate.toDate(tempTime));
        // let positionTemp = satellite.eciToEcf(posvelTemp.position, gmstTemp);
        let positionTemp = posvelTemp.position;
        orbitPoints.push(Cartesian3.fromArray(Object.values(positionTemp)));
    }

    //convert coordinates from kilometers to meters
    orbitPoints.forEach((point) => Cartesian3.multiplyByScalar(point, 1000, point));

    //polyline material
    let polylineMaterial = new Material.fromType('Color'); //create polyline material
    polylineMaterial.uniforms.color = Color.YELLOW; //set the material color

    polylines.removeAll();
    polylines.add({
        loop: true,
        positions: orbitPoints,
        width: 1,
        material: polylineMaterial,
        id: 'orbit'
    });
};

const updateSatellites = () => { //updates satellites
    posvel = satellite.propagate(satrec, JulianDate.toDate(viewer.clock.currentTime));
    gmst = satellite.gstime(JulianDate.toDate(viewer.clock.currentTime));
    geodeticCoords = satellite.eciToGeodetic(posvel.position, gmst);
    points[0].position = Cartesian3.fromRadians(geodeticCoords.longitude, geodeticCoords.latitude, geodeticCoords.height * 1000);
};

const satUpdateInterval = setInterval(updateSatellites, satUpdateIntervalTime); //enables satellites positions update
viewer.scene.postUpdate.addEventListener(cameraIcrf); //enables camera lock at the start
viewer.scene.postUpdate.addEventListener(orbitIcrf); //enables orbit lock at the start
viewer.camera.changed.addEventListener((camera) => { //enable camera lock after zoom
    if (viewer.scene.mode === SceneMode.SCENE3D) {
        if (viewer.camera.getMagnitude() < 8000000) {
            disableCamIcrf();
            sw2.checked = true;
            sw2.disabled = true;
        } else {
            sw2.disabled = false;
        }
    }
});