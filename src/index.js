import { Ion, Cesium3DTileset, createWorldTerrain, IonResource, Viewer } from 'cesium';
import "cesium/Build/Cesium/Widgets/widgets.css";
import "./css/main.css";

Ion.defaultAccessToken = process.env.ACCESS_TOKEN;

var viewer = new Viewer('cesiumContainer', {
    // terrainProvider: createWorldTerrain()
    shouldAnimate: true,
});

// var tileset = new Cesium3DTileset({
//     url: IonResource.fromAssetId(40866)
// });

// viewer.scene.primitives.add(tileset);
// viewer.zoomTo(tileset);
